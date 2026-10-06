/* SharePoint sync for Thermal Test Report Builder (Microsoft Graph + MSAL.js).
 *
 * Same Azure app and SharePoint site as Project-TIM-management-tool. Layout in the
 * site's 文件 (Shared Documents) library — folders are created automatically:
 *
 *   Thermal_Report_Builder/Database/reports/<reportId>.json   one file per report
 *   Thermal_Report_Builder/Database/tim_library.json          shared TIM library
 *   Thermal_Report_Builder/Backup/thermal_reports_backup_YYYY-MM-DD.json  (newest 30)
 *   Thermal_Report_Builder/Reports/<案名>_<Stage>/<PDF>       optional PDF uploads
 *
 * Dual save: the local database file stays the working copy (fileDb.js). Every
 * local save marks the changed reports dirty; this engine pushes exactly those
 * reports to SharePoint and pulls reports other people changed, so both places
 * hold the same data. Each report file is written with If-Match: <eTag>:
 *   · someone else changed the same report since we last synced → our version is
 *     written (we are the one editing it) and THEIR version is kept as a separate
 *     "（衝突副本）" report — nothing is ever silently overwritten;
 *   · a report deleted here but changed there meanwhile is restored, not deleted;
 *   · offline / signed out → changes stay marked in the local file and are pushed
 *     on the next successful sync (also after a reload).
 */
(() => {
  'use strict';

  const CONFIG = {
    clientId: '17fc1ab4-0ab0-4520-9315-6faa86d9e8ec',
    authority: 'https://login.microsoftonline.com/19f25823-17ff-421f-ad4e-8fed035aedda',
    scopes: ['Files.ReadWrite.All', 'Sites.Read.All', 'Sites.ReadWrite.All'],
    siteHostname: 'deltao365.sharepoint.com',
    sitePath: '/sites/Thermal-Spec-DB',
    siteName: 'Thermal-Spec-DB',
    root: 'Thermal_Report_Builder',
  };
  const REPORTS_FOLDER = CONFIG.root + '/Database/reports';
  const TIM_PATH = CONFIG.root + '/Database/tim_library.json';
  const BACKUP_FOLDER = CONFIG.root + '/Backup';
  const EXPORTS_FOLDER = CONFIG.root + '/Reports';
  const MSAL = {
    integrity: 'sha384-hhkHFODse2T75wPL7oJ0RZ+0CgRa74LNPhgx6wO6DMNEhU3/fSbTZdVzxsgyUelp',
    urls: [
      'https://alcdn.msauth.net/browser/2.38.2/js/msal-browser.min.js',
      'https://cdn.jsdelivr.net/npm/@azure/msal-browser@2.38.2/lib/msal-browser.min.js',
    ],
  };
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  const GET_MS = 30000, PUT_MS = 120000;
  const PUSH_DEBOUNCE_MS = 4000, POLL_MS = 60000, RETRY_MS = 30000;
  const LS_ENABLED = 'thermal_sp_enabled';
  const LS_BACKUP = 'thermal_sp_last_backup';
  const BACKUP_PREFIX = 'thermal_reports_backup_', BACKUP_KEEP = 30;
  const REPORT_FORMAT = 'thermal-report-v1', TIM_FORMAT = 'thermal-tim-library-v1';

  let pca = null, initP = null, account = null, siteId = null, needsLogin = false;
  let openReportId = null;
  const deferred = new Set();          // remote changes held back while that report is open
  let running = null, again = false;
  let pushTimer = null, retryTimer = null, pollTimer = null;
  let status = { state: 'off', message: '', lastSync: null, pending: 0 };
  const listeners = { status: new Set(), remote: new Set(), notice: new Set() };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const enc = p => String(p).split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const mkErr = (msg, props) => Object.assign(new Error(msg), props || {});
  const emit = (kind, arg) => listeners[kind].forEach(fn => { try { fn(arg); } catch (e) { console.error(e); } });
  const isEnabled = () => { try { return localStorage.getItem(LS_ENABLED) === '1'; } catch (e) { return false; } };
  const setEnabled = (on) => { try { if (on) localStorage.setItem(LS_ENABLED, '1'); else localStorage.removeItem(LS_ENABLED); } catch (e) { /* private mode */ } };
  const db = () => window.fileDb;
  const today = () => (window.localDateStr ? window.localDateStr() : new Date().toISOString().slice(0, 10));

  function setStatus(state, message) {
    status = {
      state,
      message: message || '',
      lastSync: state === 'synced' ? new Date() : status.lastSync,
      pending: db() && db().isReady() ? db().sync.pendingCount() : 0,
    };
    emit('status', status);
  }

  // ───────── MSAL ─────────
  /** auth.html next to the tool (registered as an SPA redirect URI in the Azure app). */
  function redirectUri() { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'auth.html'; }

  function loadScript(url, integrity, ms) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      const t = setTimeout(() => { s.remove(); reject(new Error('timeout')); }, ms);
      s.src = url; s.integrity = integrity; s.crossOrigin = 'anonymous'; s.async = true;
      s.onload = () => { clearTimeout(t); resolve(); };
      s.onerror = () => { clearTimeout(t); s.remove(); reject(new Error('load failed')); };
      document.head.appendChild(s);
    });
  }
  async function loadMsal() {
    if (window.msal) return window.msal;
    for (const url of MSAL.urls) {
      try { await loadScript(url, MSAL.integrity, 20000); if (window.msal) return window.msal; } catch (e) { /* next mirror */ }
    }
    throw mkErr('無法載入 Microsoft 登入元件（請確認網路連線）');
  }

  function init() {
    if (pca) return Promise.resolve(pca);
    if (initP) return initP;
    initP = (async () => {
      const msal = await loadMsal();
      const app = new msal.PublicClientApplication({
        auth: { clientId: CONFIG.clientId, authority: CONFIG.authority, redirectUri: redirectUri() },
        cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false },
      });
      if (typeof app.initialize === 'function') await app.initialize();
      try { const r = await app.handleRedirectPromise(); if (r && r.account) account = r.account; } catch (e) { /* no redirect in progress */ }
      if (!account) { const all = app.getAllAccounts(); if (all.length) account = all[0]; }
      pca = app;
      return app;
    })();
    initP.catch(() => { initP = null; });
    return initP;
  }

  async function token(interactive) {
    await init();
    if (!account) { needsLogin = true; throw mkErr('尚未登入 Microsoft 帳號', { auth: true }); }
    try {
      const r = await pca.acquireTokenSilent({ scopes: CONFIG.scopes, account });
      needsLogin = false;
      return r.accessToken;
    } catch (e) {
      if (!interactive) { needsLogin = true; throw mkErr('Microsoft 登入已過期，請重新登入', { auth: true }); }
      const r = await pca.acquireTokenPopup({ scopes: CONFIG.scopes, account });
      if (r.account) account = r.account;
      needsLogin = false;
      return r.accessToken;
    }
  }

  // ───────── Graph ─────────
  async function timed(url, opts, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, Object.assign({}, opts, { signal: ctl.signal })); }
    catch (e) {
      throw mkErr(e && e.name === 'AbortError'
        ? 'SharePoint 連線逾時（' + Math.round(ms / 1000) + ' 秒沒有回應）'
        : '無法連線到 SharePoint（' + ((e && e.message) || e) + '）', { network: true });
    } finally { clearTimeout(t); }
  }

  async function httpErr(res) {
    let detail = '';
    try { const j = await res.json(); detail = (j && j.error && (j.error.message || j.error.code)) || ''; } catch (e) { /* not JSON */ }
    const s = res.status;
    const msg = s === 401 ? 'Microsoft 登入已過期，請重新登入'
      : s === 403 ? '沒有權限存取 SharePoint 網站 ' + CONFIG.siteName + '（請確認帳號有該網站的編輯權限）'
      : s === 404 ? '在 SharePoint 上找不到'
      : s === 409 ? 'SharePoint 上已有同名檔案'
      : s === 412 ? '檔案剛被其他人更新'
      : s === 423 ? 'SharePoint 檔案被鎖定（可能正在同步或被其他程式開啟）'
      : s === 429 ? 'SharePoint 要求放慢速度（429）'
      : s === 507 ? 'SharePoint 空間不足'
      : 'SharePoint 錯誤 ' + s;
    return mkErr(msg + (detail && s !== 404 && s !== 412 ? '：' + detail : ''),
      { status: s, auth: s === 401, conflict: s === 412 || s === 409 });
  }

  /** Graph request with timeout; GET retries once on network errors / 429 / 5xx. */
  async function graph(path, o) {
    o = o || {};
    const method = o.method || 'GET';
    const url = /^https:/.test(path) ? path : GRAPH + path;
    const tries = method === 'GET' ? 2 : 1;
    let last = null;
    for (let i = 0; i < tries; i++) {
      if (i) await sleep(700);
      const headers = Object.assign({ Authorization: 'Bearer ' + await token(!!o.interactive) }, o.headers || {});
      let res;
      try { res = await timed(url, { method, headers, body: o.body, cache: 'no-store' }, o.timeout || (method === 'GET' ? GET_MS : PUT_MS)); }
      catch (e) { last = e; continue; }
      if (res.ok || (o.ok && o.ok(res.status))) return res;
      last = await httpErr(res);
      if (res.status === 401) needsLogin = true;
      if (!(res.status === 429 || res.status >= 500)) break;
    }
    throw last;
  }

  async function resolveSite(interactive) {
    if (siteId) return siteId;
    const res = await graph('/sites/' + CONFIG.siteHostname + ':' + CONFIG.sitePath + '?$select=id', { interactive, ok: s => s === 404 });
    if (res.status === 404) throw mkErr('找不到 SharePoint 網站 ' + CONFIG.siteHostname + CONFIG.sitePath, { status: 404 });
    siteId = (await res.json()).id;
    return siteId;
  }
  const byPath = p => '/sites/' + siteId + '/drive/root:/' + enc(p);
  const reportPath = id => REPORTS_FOLDER + '/' + id + '.json';
  const byName = item => (item && item.lastModifiedBy && item.lastModifiedBy.user && item.lastModifiedBy.user.displayName) || '';

  /** Remote reports: Map id → { etag, modified, by }. A missing folder = no reports yet. */
  async function listRemote() {
    const out = new Map();
    let url = byPath(REPORTS_FOLDER) + ':/children?$select=name,eTag,lastModifiedDateTime,lastModifiedBy&$top=200';
    while (url) {
      const res = await graph(url, { ok: s => s === 404 });
      if (res.status === 404) return out;
      const j = await res.json();
      (j.value || []).forEach(it => {
        const m = /^(.+)\.json$/i.exec(it.name || '');
        if (m) out.set(m[1], { etag: it.eTag, modified: it.lastModifiedDateTime, by: byName(it) });
      });
      url = j['@odata.nextLink'] || null;
    }
    return out;
  }

  async function itemMeta(path) {
    const res = await graph(byPath(path) + '?$select=eTag,lastModifiedDateTime,lastModifiedBy', { ok: s => s === 404 });
    if (res.status === 404) return null;
    const j = await res.json();
    return { etag: j.eTag, modified: j.lastModifiedDateTime, by: byName(j) };
  }

  /**
   * Download a JSON file together with the eTag of exactly that content: the metadata
   * is re-checked after the download and the content fetched again if it moved on.
   */
  async function downloadJson(path, etagHint) {
    let etag = etagHint;
    for (let i = 0; i < 3; i++) {
      const res = await graph(byPath(path) + ':/content');
      const text = await res.text();
      const m = await itemMeta(path);
      if (!m) throw mkErr('SharePoint 上的檔案剛被刪除', { status: 404, vanished: true });
      if (etag && m.etag !== etag && i < 2) { etag = m.etag; continue; }
      let data;
      try { data = JSON.parse(text); } catch (e) { throw mkErr('SharePoint 上的 ' + path.split('/').pop() + ' 不是有效的 JSON'); }
      return { data, etag: m.etag, by: m.by, modified: m.modified };
    }
    throw mkErr('SharePoint 檔案一直在變動，請稍後再試');
  }

  async function downloadReport(id, etagHint) {
    const r = await downloadJson(reportPath(id), etagHint);
    const rep = r.data && r.data.report;
    if (!r.data || r.data.format !== REPORT_FORMAT || !rep || typeof rep !== 'object' || typeof rep.pages !== 'object') {
      throw mkErr('SharePoint 上的報告檔 ' + id + '.json 格式不正確');
    }
    return { report: rep, etag: r.etag, by: r.by, modified: r.modified };
  }

  /** PUT a JSON file. ifMatch: eTag we expect; create: fail if the file already exists. → new eTag */
  async function uploadJson(path, obj, ifMatch, create) {
    const headers = { 'Content-Type': 'application/json' };
    if (ifMatch) headers['If-Match'] = ifMatch;
    const q = create ? '?@microsoft.graph.conflictBehavior=fail' : '';
    const res = await graph(byPath(path) + ':/content' + q, { method: 'PUT', body: JSON.stringify(obj), headers });
    const j = await res.json().catch(() => ({}));
    return j.eTag || null;
  }
  const uploadReport = (id, report, ifMatch, create) =>
    uploadJson(reportPath(id), { format: REPORT_FORMAT, id, report }, ifMatch, create);

  async function deleteRemote(path, ifMatch) {
    const headers = ifMatch ? { 'If-Match': ifMatch } : {};
    await graph(byPath(path), { method: 'DELETE', headers, ok: s => s === 404 });
  }

  // ───────── merge helpers ─────────
  const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const rid = () => 'rpt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  function stamp(iso) {
    const d = iso ? new Date(iso) : new Date();
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** TIM library union: local entries win for the same (category, name); remote-only entries are added. */
  function mergeTim(local, remote) {
    const out = {};
    ['grease', 'pad', 'putty'].forEach(cat => {
      const l = (local && local[cat]) || [];
      const r = (remote && remote[cat]) || [];
      const names = new Set(l.map(t => String(t.name || '').trim().toLowerCase()).filter(Boolean));
      out[cat] = [...l, ...r.filter(t => { const n = String(t.name || '').trim().toLowerCase(); return n && !names.has(n); })];
    });
    return out;
  }

  // ───────── sync run ─────────
  async function runSync() {
    const fdb = db();
    if (!isEnabled() || !fdb || !fdb.isReady()) return;
    const gen = fdb.sync.generation();
    const stale = () => fdb.sync.generation() !== gen;
    const notes = [];
    const info = { pulled: 0, removed: 0, pushed: 0, copies: 0, restored: 0, timChanged: false };
    let localChanged = false, rerun = false;
    setStatus('syncing', '同步中…');
    clearTimeout(retryTimer);
    try {
      await token(false);
      await resolveSite(false);
      const remote = await listRemote();
      if (stale()) return;

      // Keep someone else's version as its own report before our version replaces it.
      const keepRemoteCopy = (rem, meta) => {
        const copy = JSON.parse(JSON.stringify(rem));
        const who = (meta && meta.by) || 'SharePoint';
        copy.project_name = (rem.project_name || '未命名報告') + `（衝突副本 · ${who} · ${stamp(meta && meta.modified)}）`;
        copy.created_at = copy.updated_at = new Date().toISOString();
        fdb.sync.addReport(rid(), copy);
        info.copies++;
        rerun = true;
        notes.push(`「${rem.project_name || '未命名報告'}」同時在 SharePoint 被 ${who} 修改：保留你的版本，對方版本另存為「衝突副本」。`);
      };

      // ── pull: reports changed / created / deleted by other people ──
      let st = fdb.sync.state();
      const localIds = new Set(fdb.sync.reportIds());
      for (const [id, r] of remote) {
        if (st.dirty[id] !== undefined || st.deleted.includes(id)) continue;   // the push below handles it
        if (st.etags[id] === r.etag) continue;                                 // up to date
        if (id === openReportId) { deferred.add(id); continue; }               // never swap the report being edited
        let got;
        try { got = await downloadReport(id, r.etag); }
        catch (e) { if (e.vanished) continue; throw e; }
        if (stale()) return;
        if (!st.etags[id] && localIds.has(id)) {
          // First link of a report that exists on both sides.
          if (sameJson(fdb.sync.getReport(id), got.report)) fdb.sync.setEtag(id, got.etag);
          else fdb.sync.markDirty(id);          // push decides (ours wins, theirs kept as a copy)
        } else {
          fdb.sync.applyRemote(id, got.report, got.etag);
          info.pulled++;
        }
        localChanged = true;
      }
      for (const id of Object.keys(st.etags)) {
        if (remote.has(id) || st.dirty[id] !== undefined || st.deleted.includes(id) || !localIds.has(id)) continue;
        if (id === openReportId) { deferred.add(id); continue; }
        fdb.sync.removeLocal(id);               // deleted on SharePoint (it keeps a recycle-bin copy)
        info.removed++;
        localChanged = true;
      }
      for (const id of localIds) {              // never synced → upload
        if (!st.etags[id] && st.dirty[id] === undefined && !remote.has(id)) { fdb.sync.markDirty(id); localChanged = true; }
      }
      const timRemote = await itemMeta(TIM_PATH);
      if (timRemote && timRemote.etag !== st.tim_etag && !st.tim_dirty) {
        const got = await downloadJson(TIM_PATH, timRemote.etag);
        if (got.data && got.data.format === TIM_FORMAT && got.data.tim_library) {
          fdb.sync.applyRemoteTim(got.data.tim_library, got.etag);
          info.timChanged = true;
          localChanged = true;
        }
      } else if (!timRemote && !st.tim_etag && !st.tim_dirty) {
        const lib = fdb.sync.getTim();
        if ((lib.grease || []).length + (lib.pad || []).length + (lib.putty || []).length) { fdb.sync.markTimDirty(); localChanged = true; }
      }
      if (stale()) return;
      if (localChanged) await fdb.sync.persist();

      // ── push: reports changed here ──
      st = fdb.sync.state();
      for (const id of Object.keys(st.dirty)) {
        if (stale()) return;
        const seq = st.dirty[id];
        const local = fdb.sync.getReport(id);
        if (!local) continue;
        const r = remote.get(id);
        let ifMatch = st.etags[id] || null;
        let create = !r;
        if (r && r.etag !== ifMatch) {
          // Changed on SharePoint since our base (or never linked): keep theirs if it differs.
          const got = await downloadReport(id, r.etag);
          if (!sameJson(local, got.report)) keepRemoteCopy(got.report, got);
          ifMatch = got.etag; create = false;
        }
        let etag;
        try {
          etag = await uploadReport(id, local, ifMatch, create);
        } catch (e) {
          if (!e.conflict) throw e;
          // Someone saved between our check and our write: same handling, once more.
          const m = await itemMeta(reportPath(id));
          if (m) {
            const got = await downloadReport(id, m.etag);
            if (!sameJson(local, got.report)) keepRemoteCopy(got.report, got);
            etag = await uploadReport(id, local, got.etag, false);
          } else {
            etag = await uploadReport(id, local, null, true);
          }
        }
        fdb.sync.markPushed(id, etag, seq);
        fdb.sync.persist().catch(() => {});      // record the new eTag promptly (coalesced write)
        info.pushed++;
      }
      for (const id of st.deleted) {
        if (stale()) return;
        const r = remote.get(id);
        const known = st.etags[id];
        const restore = async (etagHint) => {
          const got = await downloadReport(id, etagHint);
          fdb.sync.applyRemote(id, got.report, got.etag);
          info.restored++;
          notes.push(`「${got.report.project_name || '未命名報告'}」已被 ${got.by || '其他人'} 修改，未從 SharePoint 刪除，已還原到本機。`);
        };
        if (!r) { fdb.sync.markDeletePushed(id); continue; }
        if (r.etag !== known) { await restore(r.etag); continue; }
        try { await deleteRemote(reportPath(id), known); fdb.sync.markDeletePushed(id); }
        catch (e) { if (e.conflict) await restore(null); else throw e; }
      }
      if (st.tim_dirty) {
        const seq = st.tim_dirty;
        let lib = fdb.sync.getTim();
        const m = await itemMeta(TIM_PATH);
        let ifMatch = st.tim_etag || null;
        if (m && m.etag !== ifMatch) {
          const got = await downloadJson(TIM_PATH, m.etag);
          lib = mergeTim(lib, got.data && got.data.tim_library);
          fdb.sync.setTim(lib);
          ifMatch = got.etag;
          info.timChanged = true;
        }
        let etag;
        try { etag = await uploadJson(TIM_PATH, { format: TIM_FORMAT, tim_library: lib }, ifMatch, !m); }
        catch (e) {
          if (!e.conflict) throw e;
          rerun = true;                          // merge again on the next run
          etag = null;
        }
        if (etag) fdb.sync.markTimPushed(etag, seq);
      }
      if (stale()) return;
      await fdb.sync.persist();
      await maybeBackup();
      setStatus('synced', '');
      if (info.pulled || info.removed || info.copies || info.restored || info.timChanged) emit('remote', info);
      notes.forEach(n => emit('notice', n));
      if (rerun || fdb.sync.hasPending()) schedulePush(1500);
    } catch (e) {
      if (e && e.auth) setStatus('needs-login', e.message);
      else {
        setStatus(fdb.sync.hasPending() ? 'pending' : 'error', (e && e.message) || String(e));
        retryTimer = setTimeout(() => syncNow(), RETRY_MS);
      }
      if (notes.length) notes.forEach(n => emit('notice', n));
    }
  }

  async function maybeBackup() {
    let last = null;
    try { last = localStorage.getItem(LS_BACKUP); } catch (e) { /* ignore */ }
    if (last === today()) return;
    try {
      const name = BACKUP_PREFIX + today() + '.json';
      await graph(byPath(BACKUP_FOLDER + '/' + name) + ':/content',
        { method: 'PUT', body: db().sync.backupText(), headers: { 'Content-Type': 'application/json' } });
      try { localStorage.setItem(LS_BACKUP, today()); } catch (e) { /* ignore */ }
      const names = [];
      let url = byPath(BACKUP_FOLDER) + ':/children?$select=name&$top=200';
      while (url) {
        const j = await (await graph(url)).json();
        (j.value || []).forEach(x => names.push(x.name));
        url = j['@odata.nextLink'] || null;
      }
      const b = names.filter(n => n.startsWith(BACKUP_PREFIX) && n.endsWith('.json')).sort();
      for (const n of b.slice(0, Math.max(0, b.length - BACKUP_KEEP))) {
        try { await deleteRemote(BACKUP_FOLDER + '/' + n, null); } catch (e) { /* next time */ }
      }
    } catch (e) { /* a missed backup never fails the sync */ }
  }

  function syncNow() {
    if (!isEnabled()) return Promise.resolve();
    clearTimeout(pushTimer);
    if (running) { again = true; return running; }
    running = runSync().finally(() => {
      running = null;
      if (again) { again = false; schedulePush(500); }
    });
    return running;
  }

  function schedulePush(ms) {
    if (!isEnabled() || !account) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, ms == null ? PUSH_DEBOUNCE_MS : ms);
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && isEnabled() && account && !needsLogin) syncNow();
    }, POLL_MS);
  }

  // Push shortly after every local save that left something to send.
  function hookLocalWrites() {
    if (!db() || hookLocalWrites.done) return;
    hookLocalWrites.done = true;
    db().onWrite(() => {
      if (!isEnabled() || !account || running) { if (running) again = again || db().sync.hasPending(); return; }
      if (db().sync.hasPending()) schedulePush();
    });
  }

  const spSync = {
    config: CONFIG,
    folders: { root: CONFIG.root, reports: REPORTS_FOLDER, tim: TIM_PATH, backup: BACKUP_FOLDER, exports: EXPORTS_FOLDER },
    isEnabled,
    status() { return status; },
    account() { return account ? { name: account.name || account.username || '', email: account.username || '' } : null; },
    location() { return CONFIG.siteName + ' / 文件 / ' + CONFIG.root; },
    onStatus(fn) { listeners.status.add(fn); return () => listeners.status.delete(fn); },
    onRemoteChange(fn) { listeners.remote.add(fn); return () => listeners.remote.delete(fn); },
    onNotice(fn) { listeners.notice.add(fn); return () => listeners.notice.delete(fn); },
    mergeTim,

    /** Turn on dual save (click handler: may open the Microsoft sign-in popup). */
    async enable() {
      hookLocalWrites();
      setEnabled(true);
      const r = await spSync.signIn();
      if (!r.ok) { setEnabled(false); setStatus('off', ''); return r; }
      try { await resolveSite(true); }
      catch (e) { setStatus('error', e.message); return { ok: false, reason: 'error', error: e.message }; }
      startPolling();
      await syncNow();
      return { ok: true };
    },
    disable() {
      setEnabled(false);
      clearTimeout(pushTimer); clearTimeout(retryTimer);
      setStatus('off', '');
    },

    /** Sign in (click handler). opts.select: always let the user pick the account. */
    async signIn(opts) {
      try { await init(); } catch (e) { return { ok: false, reason: 'error', error: e.message }; }
      if (account && !(opts && opts.select)) {
        try { await token(true); setStatus(status.state === 'needs-login' ? 'pending' : status.state); return { ok: true }; } catch (e) { /* popup below */ }
      }
      try {
        const r = await pca.loginPopup({ scopes: CONFIG.scopes, prompt: 'select_account' });
        account = r.account;
        needsLogin = false;
        siteId = null;
        return { ok: true };
      } catch (e) {
        const code = (e && e.errorCode) || '';
        if (code === 'user_cancelled' || code === 'popup_window_error' || code === 'interaction_in_progress') {
          return { ok: false, reason: code === 'popup_window_error' ? 'popup' : 'cancelled' };
        }
        return { ok: false, reason: 'error', error: (e && e.message) || String(e) };
      }
    },

    /** Re-sign-in after expiry, then sync (click handler). */
    async relogin() {
      const r = await spSync.signIn();
      if (r.ok) { startPolling(); await syncNow(); }
      return r;
    },

    syncNow,

    /** Page load: restore a previous sign-in silently and sync. */
    async tryRestore() {
      hookLocalWrites();
      if (!isEnabled()) { setStatus('off', ''); return; }
      try { await init(); } catch (e) { setStatus('error', e.message); return; }
      if (!account) { setStatus('needs-login', '尚未登入 Microsoft 帳號'); return; }
      startPolling();
      await syncNow();
    },

    /** Call when a local database is opened / switched. */
    dbOpened() { deferred.clear(); if (isEnabled() && account) syncNow(); else setStatus(isEnabled() ? status.state : 'off', status.message); },

    /** The report open in the editor is never replaced by a remote version. */
    setOpenReport(id) {
      openReportId = id || null;
      if (!openReportId && deferred.size) { deferred.clear(); if (isEnabled() && account) syncNow(); }
    },

    /** Upload an exported file to Reports/<folder>/<name>. → webUrl */
    async uploadExport(folder, name, blob) {
      await resolveSite(true);
      const safe = s => String(s || '').replace(/[\\/:*?"<>|#%]+/g, '_').trim() || 'Report';
      const res = await graph(byPath(EXPORTS_FOLDER + '/' + safe(folder) + '/' + safe(name)) + ':/content',
        { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'application/pdf' }, interactive: true });
      const j = await res.json().catch(() => ({}));
      return j.webUrl || null;
    },

    /** Link to the Thermal_Report_Builder folder in SharePoint (null until it exists). */
    async folderUrl() {
      await resolveSite(true);
      const res = await graph(byPath(CONFIG.root) + '?$select=webUrl', { interactive: true, ok: s => s === 404 });
      if (res.status === 404) return null;
      return (await res.json()).webUrl || null;
    },

    // Test seams.
    __reset() {
      pca = null; initP = null; account = null; siteId = null; needsLogin = false;
      openReportId = null; deferred.clear(); running = null; again = false;
      clearTimeout(pushTimer); clearTimeout(retryTimer);
      status = { state: 'off', message: '', lastSync: null, pending: 0 };
    },
    __idle() { return running || Promise.resolve(); },
  };

  window.spSync = spSync;
})();
