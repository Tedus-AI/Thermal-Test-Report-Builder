/* SharePoint sync for Thermal Test Report Builder (Microsoft Graph + MSAL.js).
 *
 * Same Azure app and SharePoint site as Project-TIM-management-tool. Layout in the
 * site's 文件 (Shared Documents) library — folders are created automatically:
 *
 *   Thermal_Report_Builder/Database/reports/<reportId>.json   one file per report (text only)
 *   Thermal_Report_Builder/Database/images/<hash>.<ext>       the reports' pictures, each stored once
 *   Thermal_Report_Builder/Database/tim_library.json          shared TIM library
 *   Thermal_Report_Builder/Backup/thermal_reports_backup_YYYY-MM-DD.json  (newest 2)
 *   Thermal_Report_Builder/Reports/<案名>_<Stage>/<PDF>       newest exported PDF per folder
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
 * A changed eTag with an unchanged cTag (content tag) is the same content — e.g. old
 * versions were removed — and never counts as someone else's edit.
 *
 * Storage: SharePoint keeps every overwrite of a file as a version (up to 500) and all
 * of them count against the site quota. So a report file holds only text — each
 * picture goes up once, named by its content hash, and the report refers to it as
 * {"$img": "<name>"} — and the report open in the editor is uploaded at most every few
 * minutes. Once a day a cleanup keeps the newest 2 versions of each report file, the
 * newest 2 backups and the newest exported PDF per folder, and removes pictures no
 * report uses any more. What it deletes goes to the site recycle bin first, which
 * still counts against the quota until it is emptied.
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
  const IMAGES_FOLDER = CONFIG.root + '/Database/images';
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
  const OPEN_PUSH_GAP_MS = 3 * 60000;          // the report being edited goes up at most this often
  const LS_ENABLED = 'thermal_sp_enabled';
  const LS_BACKUP = 'thermal_sp_last_backup';
  const LS_BACKUP_SIG = 'thermal_sp_backup_sig';
  const LS_CLEANUP = 'thermal_sp_last_cleanup';
  const BACKUP_PREFIX = 'thermal_reports_backup_', BACKUP_KEEP = 2;
  const KEEP_VERSIONS = 2;                     // report files / TIM library: current + previous
  const IMAGE_GC_AGE_MS = 7 * 86400000;        // a picture no report uses is removed once this old
  const CLEANUP_AUTO_MAX = 500, CLEANUP_MANUAL_MAX = 5000;   // deletions per cleanup run
  const KNOWN_IMAGES_TTL_MS = 10 * 60000;
  const EXPORT_PDF = /ThermalReport[^/]*\.pdf$/i;
  const REPORT_FORMAT = 'thermal-report-v1', REPORT_FORMAT_V2 = 'thermal-report-v2', TIM_FORMAT = 'thermal-tim-library-v1';

  let pca = null, initP = null, account = null, siteId = null, needsLogin = false;
  let openReportId = null;
  const deferred = new Set();          // remote changes held back while that report is open
  let running = null, again = false, forceNext = false;
  let pushTimer = null, retryTimer = null, pollTimer = null;
  const lastPush = new Map();          // reportId → when this session last uploaded it
  let cleaning = null, versionsBlocked = '', quotaWarned = false;
  const cleanupProgress = new Set();
  let status = { state: 'off', message: '', lastSync: null, pending: 0 };
  const listeners = { status: new Set(), remote: new Set(), notice: new Set() };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const enc = p => String(p).split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const mkErr = (msg, props) => Object.assign(new Error(msg), props || {});
  const emit = (kind, arg) => listeners[kind].forEach(fn => { try { fn(arg); } catch (e) { console.error(e); } });
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const isEnabled = () => lsGet(LS_ENABLED) === '1';
  const setEnabled = (on) => { try { if (on) localStorage.setItem(LS_ENABLED, '1'); else localStorage.removeItem(LS_ENABLED); } catch (e) { /* private mode */ } };
  const db = () => window.fileDb;
  const today = () => (window.localDateStr ? window.localDateStr() : new Date().toISOString().slice(0, 10));
  const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');

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
  // Sign-in redirect page. Azure only accepts redirect URIs registered in the
  // app, and the shared app registers the TIM tool's blank auth.html. On the same
  // GitHub Pages origin that page is reused (same origin → MSAL here can still
  // read the popup / silent-renewal iframe result), so no Azure change is needed.
  // Anywhere else (e.g. http://localhost) auth.html next to the tool is used and
  // must be registered as an SPA redirect URI.
  const SHARED_REDIRECT_URI = 'https://tedus-ai.github.io/Project-TIM-management-tool/auth.html';
  function redirectUri() {
    if (location.origin === new URL(SHARED_REDIRECT_URI).origin) return SHARED_REDIRECT_URI;
    return location.origin + location.pathname.replace(/[^/]*$/, '') + 'auth.html';
  }

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
      : s === 507 ? 'SharePoint 空間不足（請從 ☁ 選單的「SharePoint 空間」清理舊版本，並清空網站回收站）'
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
  const metaOf = j => ({ id: j.id || null, etag: j.eTag || null, ctag: j.cTag || null, size: Number(j.size) || 0, modified: j.lastModifiedDateTime || null, by: byName(j) });
  /** Same file content: the same version (eTag), or a newer eTag with the same content tag. */
  const sameContent = (a, b) => !!(a && b && ((a.etag && a.etag === b.etag) || (a.ctag && a.ctag === b.ctag)));

  /** Items in a folder (name, id, eTag, cTag, size, …); a missing folder = none. */
  async function listChildren(path) {
    const out = [];
    let url = byPath(path) + ':/children?$select=id,name,eTag,cTag,size,lastModifiedDateTime,lastModifiedBy,file,folder&$top=200';
    while (url) {
      const res = await graph(url, { ok: s => s === 404 });
      if (res.status === 404) return out;
      const j = await res.json();
      (j.value || []).forEach(it => out.push(Object.assign(metaOf(it), { name: it.name || '', isFolder: !!it.folder })));
      url = j['@odata.nextLink'] || null;
    }
    return out;
  }

  /** Remote reports: Map id → { id (item), etag, ctag, size, modified, by }. */
  async function listRemote() {
    const out = new Map();
    (await listChildren(REPORTS_FOLDER)).forEach(it => {
      const m = !it.isFolder && /^(.+)\.json$/i.exec(it.name);
      if (m) out.set(m[1], it);
    });
    return out;
  }

  async function itemMeta(path) {
    const res = await graph(byPath(path) + '?$select=id,eTag,cTag,size,lastModifiedDateTime,lastModifiedBy', { ok: s => s === 404 });
    if (res.status === 404) return null;
    return metaOf(await res.json());
  }

  /**
   * Download a JSON file together with the eTag / cTag of exactly that content: the
   * metadata is re-checked after the download and the content fetched again if it moved on.
   * want: the version we expect ({ etag, ctag }), e.g. from a folder listing.
   */
  async function downloadJson(path, want) {
    for (let i = 0; i < 3; i++) {
      const res = await graph(byPath(path) + ':/content');
      const text = await res.text();
      const m = await itemMeta(path);
      if (!m) throw mkErr('SharePoint 上的檔案剛被刪除', { status: 404, vanished: true });
      if (want && !sameContent(m, want) && i < 2) { want = m; continue; }
      let data;
      try { data = JSON.parse(text); } catch (e) { throw mkErr('SharePoint 上的 ' + path.split('/').pop() + ' 不是有效的 JSON'); }
      return Object.assign({ data }, m);
    }
    throw mkErr('SharePoint 檔案一直在變動，請稍後再試');
  }

  async function downloadReport(id, want) {
    const r = await downloadJson(reportPath(id), want);
    const d = r.data;
    let rep = d && (d.format === REPORT_FORMAT || d.format === REPORT_FORMAT_V2) ? d.report : null;
    if (!rep || typeof rep !== 'object' || typeof rep.pages !== 'object') {
      throw mkErr('SharePoint 上的報告檔 ' + id + '.json 格式不正確');
    }
    let missing = 0;
    if (d.format === REPORT_FORMAT_V2) {
      if (!canSplitImages()) throw mkErr('這個瀏覽器無法讀取報告的圖片（需要 https 安全連線）');
      const j = await joinImages(rep, db() && db().isReady() ? db().sync.getReport(id) : null);
      rep = j.data; missing = j.missing;
    }
    return Object.assign({}, r, { data: undefined, report: rep, missing });
  }

  /** PUT a JSON file. ifMatch: eTag we expect; create: fail if the file already exists. → { etag, ctag, … } */
  async function uploadJson(path, obj, ifMatch, create) {
    const headers = { 'Content-Type': 'application/json' };
    if (ifMatch) headers['If-Match'] = ifMatch;
    const q = create ? '?@microsoft.graph.conflictBehavior=fail' : '';
    const res = await graph(byPath(path) + ':/content' + q, { method: 'PUT', body: JSON.stringify(obj), headers });
    return metaOf(await res.json().catch(() => ({})));
  }

  /** A report file holds the text; its pictures go to Database/images first (each only once). */
  async function uploadReport(id, report, ifMatch, create) {
    if (!canSplitImages()) return uploadJson(reportPath(id), { format: REPORT_FORMAT, id, report }, ifMatch, create);
    const s = await splitImages(report);
    await uploadImages(s.files);
    return uploadJson(reportPath(id), { format: REPORT_FORMAT_V2, id, images: Array.from(s.files.keys()), report: s.data }, ifMatch, create);
  }

  async function deleteRemote(path, ifMatch) {
    const headers = ifMatch ? { 'If-Match': ifMatch } : {};
    await graph(byPath(path), { method: 'DELETE', headers, ok: s => s === 404 });
  }

  // ───────── pictures: stored once, by content ─────────
  // Every data:image/…;base64 string of IMG_MIN+ characters in a report is replaced by
  // { "$img": "<sha-256 of the base64 text, 40 hex>.<ext>" } in the SharePoint file and
  // the picture is uploaded to Database/images under that name. Pulling puts the exact
  // same string back (taken from the local copy when it is already there), so a pulled
  // report compares equal to the pushed one.
  const IMG_REF = '$img';
  const IMG_MIN = 2048;                      // icons / tiny pictures stay inline
  const IMG_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' };
  const IMG_MIMES = Object.fromEntries(Object.entries(IMG_TYPES).map(([m, e]) => [e, m]));
  const DATA_IMG = /^data:(image\/(?:jpeg|png|gif|webp|bmp|svg\+xml));base64,/;
  const IMG_NAME = /^[0-9a-f]{40}\.(jpg|png|gif|webp|bmp|svg)$/;
  const MISSING_IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#f3f4f6"/>' +
    '<rect x="6" y="6" width="468" height="308" fill="none" stroke="#9ca3af" stroke-width="3" stroke-dasharray="12 8"/>' +
    '<text x="240" y="168" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#6b7280">圖片遺失（SharePoint 上找不到）</text></svg>');
  const canSplitImages = () => !!(window.crypto && crypto.subtle && typeof crypto.subtle.digest === 'function' && typeof TextEncoder === 'function');
  const isImageData = s => s.length >= IMG_MIN && s.startsWith('data:image/') && DATA_IMG.test(s);
  const isRef = v => !!v && typeof v === 'object' && !Array.isArray(v) && typeof v[IMG_REF] === 'string' && Object.keys(v).length === 1;

  function collectImages(v, out) {
    if (typeof v === 'string') { if (isImageData(v)) out.add(v); }
    else if (Array.isArray(v)) v.forEach(x => collectImages(x, out));
    else if (v && typeof v === 'object') Object.keys(v).forEach(k => collectImages(v[k], out));
  }
  function collectRefs(v, out) {
    if (isRef(v)) out.add(v[IMG_REF]);
    else if (Array.isArray(v)) v.forEach(x => collectRefs(x, out));
    else if (v && typeof v === 'object') Object.keys(v).forEach(k => collectRefs(v[k], out));
  }
  /** Deep copy with every string and picture reference passed through fn. */
  function mapLeaves(v, fn) {
    if (typeof v === 'string' || isRef(v)) return fn(v);
    if (Array.isArray(v)) return v.map(x => mapLeaves(x, fn));
    if (v && typeof v === 'object') {
      const o = {};
      Object.keys(v).forEach(k => {
        const x = mapLeaves(v[k], fn);
        if (k === '__proto__') Object.defineProperty(o, k, { value: x, enumerable: true, writable: true, configurable: true });
        else o[k] = x;
      });
      return o;
    }
    return v;
  }

  // data URL → file name ('' = stays inline). Holds references to strings the database
  // mostly holds anyway; dropped wholesale when it grows large.
  const nameCache = new Map();
  let nameCacheChars = 0;
  async function imageName(s) {
    if (nameCache.has(s)) return nameCache.get(s);
    let name = '';
    const m = DATA_IMG.exec(s);
    if (m) {
      const b64 = s.slice(m[0].length);
      // Only canonical base64 comes back byte-identical from a file.
      if (b64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(b64) && canonicalTail(b64)) {
        name = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(b64))).slice(0, 40) + '.' + IMG_TYPES[m[1]];
      }
    }
    if (nameCacheChars > 64e6) { nameCache.clear(); nameCacheChars = 0; }
    nameCache.set(s, name);
    nameCacheChars += s.length;
    return name;
  }
  function canonicalTail(b64) {
    if (!b64.endsWith('=')) return true;
    const t = b64.slice(-4);
    try { return btoa(atob(t)) === t; } catch (e) { return false; }
  }

  async function splitImages(report) {
    const strs = new Set();
    collectImages(report, strs);
    const names = new Map();
    for (const s of strs) { const n = await imageName(s); if (n) names.set(s, n); }
    const files = new Map();
    names.forEach((n, s) => files.set(n, s));
    const data = names.size ? mapLeaves(report, v => (typeof v === 'string' && names.has(v) ? { [IMG_REF]: names.get(v) } : v)) : report;
    return { data, files };
  }

  /** Put the pictures back: from the local copy of the report when it has them, else downloaded. */
  async function joinImages(data, localCopy) {
    const need = new Set();
    collectRefs(data, need);
    if (!need.size) return { data, missing: 0 };
    const have = new Map();
    if (localCopy) {
      const strs = new Set();
      collectImages(localCopy, strs);
      for (const s of strs) { const n = await imageName(s); if (n && need.has(n)) have.set(n, s); }
    }
    let missing = 0;
    for (const n of need) {
      if (have.has(n)) continue;
      const url = await downloadImage(n);
      if (url) { have.set(n, url); if (knownImages) knownImages.add(n); }
      else { have.set(n, MISSING_IMG); missing++; }
    }
    return { data: mapLeaves(data, v => (isRef(v) ? have.get(v[IMG_REF]) : v)), missing };
  }

  function dataUrlBytes(s) {
    const bin = atob(s.slice(s.indexOf(',') + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function blobDataUrl(blob, mime) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => { const s = String(fr.result); resolve('data:' + mime + ';base64,' + s.slice(s.indexOf(',') + 1)); };
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  /** → data URL, or null when the picture is missing / damaged. */
  async function downloadImage(name) {
    if (!IMG_NAME.test(name)) return null;
    const res = await graph(byPath(IMAGES_FOLDER + '/' + name) + ':/content', { ok: s => s === 404 });
    if (res.status === 404) return null;
    const url = await blobDataUrl(await res.blob(), IMG_MIMES[name.split('.').pop()]);
    return (await imageName(url)) === name ? url : null;
  }

  // Names already in Database/images (re-listed every few minutes).
  let knownImages = null, knownImagesAt = 0;
  async function uploadImages(files) {
    if (!files.size) return;
    if (!knownImages || Date.now() - knownImagesAt > KNOWN_IMAGES_TTL_MS) {
      knownImages = new Set((await listChildren(IMAGES_FOLDER)).filter(it => !it.isFolder).map(it => it.name));
      knownImagesAt = Date.now();
    }
    for (const [n, url] of files) {
      if (knownImages.has(n)) continue;
      await graph(byPath(IMAGES_FOLDER + '/' + n) + ':/content?@microsoft.graph.conflictBehavior=fail',
        { method: 'PUT', body: dataUrlBytes(url), headers: { 'Content-Type': DATA_IMG.exec(url)[1] }, ok: s => s === 409 });
      knownImages.add(n);
    }
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
  /** force: also upload the report open in the editor now (otherwise at most every OPEN_PUSH_GAP_MS). */
  async function runSync(force) {
    const fdb = db();
    if (!isEnabled() || !fdb || !fdb.isReady()) return;
    const gen = fdb.sync.generation();
    const stale = () => fdb.sync.generation() !== gen;
    const notes = [];
    const info = { pulled: 0, removed: 0, pushed: 0, copies: 0, restored: 0, timChanged: false };
    let localChanged = false, rerun = false, heldBack = 0;
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
      const noteMissing = got => {
        if (got.missing) notes.push(`「${got.report.project_name || '未命名報告'}」有 ${got.missing} 張圖片在 SharePoint 上找不到，已標示為「圖片遺失」。`);
      };

      // ── pull: reports changed / created / deleted by other people ──
      let st = fdb.sync.state();
      const base = id => ({ etag: st.etags[id] || null, ctag: st.ctags[id] || null });
      const localIds = new Set(fdb.sync.reportIds());
      for (const [id, r] of remote) {
        if (st.dirty[id] !== undefined || st.deleted.includes(id)) continue;   // the push below handles it
        if (st.etags[id] === r.etag) continue;                                 // up to date
        if (r.ctag && st.ctags[id] === r.ctag) {                               // same content, newer eTag
          fdb.sync.setEtag(id, r.etag, r.ctag);
          localChanged = true;
          continue;
        }
        if (id === openReportId) { deferred.add(id); continue; }               // never swap the report being edited
        let got;
        try { got = await downloadReport(id, r); }
        catch (e) { if (e.vanished) continue; throw e; }
        if (stale()) return;
        if (!st.etags[id] && localIds.has(id)) {
          // First link of a report that exists on both sides.
          if (sameJson(fdb.sync.getReport(id), got.report)) fdb.sync.setEtag(id, got.etag, got.ctag);
          else fdb.sync.markDirty(id);          // push decides (ours wins, theirs kept as a copy)
        } else {
          fdb.sync.applyRemote(id, got.report, got.etag, got.ctag);
          noteMissing(got);
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
        if (timRemote.ctag && timRemote.ctag === st.tim_ctag) {
          fdb.sync.setTimEtag(timRemote.etag, timRemote.ctag);
          localChanged = true;
        } else {
          const got = await downloadJson(TIM_PATH, timRemote);
          if (got.data && got.data.format === TIM_FORMAT && got.data.tim_library) {
            fdb.sync.applyRemoteTim(got.data.tim_library, got.etag, got.ctag);
            info.timChanged = true;
            localChanged = true;
          }
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
        // Every upload is a new SharePoint version: the report being edited goes up at
        // most every OPEN_PUSH_GAP_MS; leaving it, 立即同步 or 存檔 push it right away.
        const wait = id === openReportId && !force ? (lastPush.get(id) || 0) + OPEN_PUSH_GAP_MS - Date.now() : 0;
        if (wait > 0) { heldBack = heldBack ? Math.min(heldBack, wait) : wait; continue; }
        const r = remote.get(id);
        let ifMatch = st.etags[id] || null, baseCtag = st.ctags[id] || null;
        let create = !r;
        if (r && r.etag !== ifMatch) {
          if (r.ctag && r.ctag === baseCtag) ifMatch = r.etag;           // only metadata changed
          else {
            // Changed on SharePoint since our base (or never linked): keep theirs if it differs.
            const got = await downloadReport(id, r);
            if (!sameJson(local, got.report)) keepRemoteCopy(got.report, got);
            ifMatch = got.etag; baseCtag = got.ctag; create = false;
          }
        }
        let up;
        try {
          up = await uploadReport(id, local, ifMatch, create);
        } catch (e) {
          if (!e.conflict) throw e;
          // Someone saved between our check and our write: same handling, once more.
          const m = await itemMeta(reportPath(id));
          if (m && m.ctag && m.ctag === baseCtag) {
            up = await uploadReport(id, local, m.etag, false);
          } else if (m) {
            const got = await downloadReport(id, m);
            if (!sameJson(local, got.report)) keepRemoteCopy(got.report, got);
            up = await uploadReport(id, local, got.etag, false);
          } else {
            up = await uploadReport(id, local, null, true);
          }
        }
        lastPush.set(id, Date.now());
        fdb.sync.markPushed(id, up.etag, seq, up.ctag);
        fdb.sync.persist().catch(() => {});      // record the new eTag promptly (coalesced write)
        info.pushed++;
      }
      for (const id of st.deleted) {
        if (stale()) return;
        const r = remote.get(id);
        const restore = async (want) => {
          const got = await downloadReport(id, want);
          fdb.sync.applyRemote(id, got.report, got.etag, got.ctag);
          info.restored++;
          notes.push(`「${got.report.project_name || '未命名報告'}」已被 ${got.by || '其他人'} 修改，未從 SharePoint 刪除，已還原到本機。`);
        };
        if (!r) { fdb.sync.markDeletePushed(id); continue; }
        if (!sameContent(r, base(id))) { await restore(r); continue; }
        try { await deleteRemote(reportPath(id), r.etag); fdb.sync.markDeletePushed(id); }
        catch (e) {
          if (!e.conflict) throw e;
          const m = await itemMeta(reportPath(id));
          if (!m) fdb.sync.markDeletePushed(id);
          else if (sameContent(m, base(id))) { await deleteRemote(reportPath(id), m.etag); fdb.sync.markDeletePushed(id); }
          else await restore(m);
        }
      }
      if (st.tim_dirty) {
        const seq = st.tim_dirty;
        let lib = fdb.sync.getTim();
        const m = await itemMeta(TIM_PATH);
        let ifMatch = st.tim_etag || null;
        if (m && m.etag !== ifMatch) {
          if (m.ctag && m.ctag === st.tim_ctag) ifMatch = m.etag;
          else {
            const got = await downloadJson(TIM_PATH, m);
            lib = mergeTim(lib, got.data && got.data.tim_library);
            fdb.sync.setTim(lib);
            ifMatch = got.etag;
            info.timChanged = true;
          }
        }
        let up = null;
        try { up = await uploadJson(TIM_PATH, { format: TIM_FORMAT, tim_library: lib }, ifMatch, !m); }
        catch (e) {
          if (!e.conflict) throw e;
          rerun = true;                          // merge again on the next run
        }
        if (up && up.etag) fdb.sync.markTimPushed(up.etag, seq, up.ctag);
      }
      if (stale()) return;
      await fdb.sync.persist();
      await maybeBackup();
      setStatus('synced', heldBack ? `編輯中的報告每 ${OPEN_PUSH_GAP_MS / 60000} 分鐘上傳一次（離開報告、存檔或按「立即同步」會馬上上傳）` : '');
      if (info.pulled || info.removed || info.copies || info.restored || info.timChanged) emit('remote', info);
      notes.forEach(n => emit('notice', n));
      if (rerun) schedulePush(1500);
      else if (fdb.sync.hasPending()) schedulePush(heldBack ? Math.max(1500, heldBack) : 1500);
      maybeCleanup();
    } catch (e) {
      if (e && e.auth) setStatus('needs-login', e.message);
      else {
        setStatus(fdb.sync.hasPending() ? 'pending' : 'error', (e && e.message) || String(e));
        retryTimer = setTimeout(autoSync, RETRY_MS);
      }
      if (e && e.status === 507) {
        // Site full: the daily cleanup would otherwise wait for a successful sync.
        if (!quotaWarned) { quotaWarned = true; notes.push('SharePoint 網站空間已滿，報告暫時無法上傳（仍保存在本機）。請從 ☁ 選單的「SharePoint 空間」按「立即整理」，再到網站回收站「清空回收站」。'); }
        maybeCleanup();
      }
      if (notes.length) notes.forEach(n => emit('notice', n));
    }
  }

  const isBackupName = n => n.startsWith(BACKUP_PREFIX) && n.endsWith('.json');
  async function textSig(text) {
    if (!canSplitImages()) return null;
    try { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); } catch (e) { return null; }
  }

  /** Daily backup — only when the data changed since this browser's last one — keeping the newest BACKUP_KEEP. */
  async function maybeBackup() {
    if (lsGet(LS_BACKUP) === today()) return;
    try {
      const name = BACKUP_PREFIX + today() + '.json';
      const items = (await listChildren(BACKUP_FOLDER)).filter(it => !it.isFolder && isBackupName(it.name));
      const text = db().sync.backupText();
      const sig = await textSig(text);
      const done = items.some(it => it.name === name)                      // someone already backed up today
        || (sig && sig === lsGet(LS_BACKUP_SIG) && items.length > 0);      // nothing changed since our last one
      if (!done) {
        await graph(byPath(BACKUP_FOLDER + '/' + name) + ':/content',
          { method: 'PUT', body: text, headers: { 'Content-Type': 'application/json' } });
        items.push({ name });
        if (sig) lsSet(LS_BACKUP_SIG, sig);
      }
      lsSet(LS_BACKUP, today());
      const names = items.map(it => it.name).sort();
      for (const n of names.slice(0, Math.max(0, names.length - BACKUP_KEEP))) {
        try { await deleteRemote(BACKUP_FOLDER + '/' + n, null); } catch (e) { /* next time */ }
      }
    } catch (e) { /* a missed backup never fails the sync */ }
  }

  // ───────── storage cleanup ─────────
  const verOrder = v => { const m = /^(\d+)\.(\d+)$/.exec(String(v.id)); return m ? +m[1] * 1e6 + +m[2] : (Date.parse(v.lastModifiedDateTime) || 0); };
  const stopsRun = e => !!(e && (e.status === 429 || e.network || e.auth));

  /** Keep the newest `keep` versions of a file (the current one always stays). */
  async function trimVersions(itemId, keep, budget, out) {
    if (!itemId || versionsBlocked) return;
    const base = '/sites/' + siteId + '/drive/items/' + encodeURIComponent(itemId) + '/versions';
    let list = [];
    try {
      let url = base;
      while (url) {
        const res = await graph(url, { ok: s => s === 404 });
        if (res.status === 404) return;
        const j = await res.json();
        list = list.concat(j.value || []);
        url = j['@odata.nextLink'] || null;
      }
    } catch (e) { if (stopsRun(e)) throw e; return; }
    if (list.length <= keep) return;
    list.sort((a, b) => verOrder(b) - verOrder(a));          // newest (= current) first
    for (const v of list.slice(Math.max(1, keep))) {
      if (budget.left <= 0) { out.partial = true; return; }
      try {
        await graph(base + '/' + encodeURIComponent(v.id), { method: 'DELETE', ok: s => s === 404 });
      } catch (e) {
        if (stopsRun(e)) throw e;
        if ([400, 403, 405, 501].includes(e.status)) versionsBlocked = 'SharePoint 不允許用程式刪除舊版本（' + e.message + '），請到檔案的「版本歷程記錄」手動刪除。';
        return;
      }
      budget.left--; out.versions++; out.versionBytes += Number(v.size) || 0;
    }
  }

  async function removeFile(path, it, budget, out, kind) {
    if (budget.left <= 0) { out.partial = true; return false; }
    try { await deleteRemote(path, it.etag); }
    catch (e) { if (stopsRun(e)) throw e; return false; }    // changed meanwhile / locked → keep it
    budget.left--; out[kind]++; out[kind + 'Bytes'] += it.size || 0;
    return true;
  }

  /** Pictures that no report uses any more (and that are old enough not to belong to an upload in progress). */
  async function collectImageGarbage(budget, out) {
    const fdb = db();
    if (!fdb || !fdb.isReady() || !canSplitImages()) return;
    const cutoff = Date.now() - IMAGE_GC_AGE_MS;
    const old = (await listChildren(IMAGES_FOLDER)).filter(it => !it.isFolder && IMG_NAME.test(it.name) && Date.parse(it.modified) < cutoff);
    if (!old.length) return;
    const used = new Set();
    // The local reports, including edits not uploaded yet…
    const strs = new Set();
    fdb.sync.forEachReport(rep => collectImages(rep, strs));
    for (const s of strs) { const n = await imageName(s); if (n) used.add(n); }
    // …and every SharePoint report whose content is not exactly the local copy.
    const st = fdb.sync.state();
    const local = new Set(fdb.sync.reportIds());
    for (const [id, r] of await listRemote()) {
      if (local.has(id) && st.dirty[id] === undefined && !st.deleted.includes(id) && sameContent(r, { etag: st.etags[id], ctag: st.ctags[id] })) continue;
      let got;
      try { got = await downloadJson(reportPath(id), r); }
      catch (e) { if (e.vanished) continue; throw e; }
      const d = got.data;
      if (d && d.format === REPORT_FORMAT_V2) { collectRefs(d.report, used); (d.images || []).forEach(n => used.add(n)); }
    }
    for (const it of old) {
      if (used.has(it.name)) continue;
      if (await removeFile(IMAGES_FOLDER + '/' + it.name, it, budget, out, 'images') && knownImages) knownImages.delete(it.name);
    }
  }

  async function runCleanup(manual) {
    const budget = { left: manual ? CLEANUP_MANUAL_MAX : CLEANUP_AUTO_MAX };
    const out = { versions: 0, versionBytes: 0, backups: 0, backupsBytes: 0, exports: 0, exportsBytes: 0, images: 0, imagesBytes: 0, skipped: 0, partial: false, blocked: '', error: '' };
    const step = msg => cleanupProgress.forEach(fn => { try { fn(msg, out); } catch (e) { console.error(e); } });
    try {
      await token(false);
      await resolveSite(false);
      // 1. Version history of the report files and the TIM library. Needs the cTag, so
      //    the sync can tell "old versions removed" from "edited by someone else".
      const remote = await listRemote();
      let k = 0;
      for (const r of remote.values()) {
        step(`清理報告檔的舊版本…（${++k}/${remote.size}）`);
        if (!r.ctag) { out.skipped++; continue; }
        await trimVersions(r.id, KEEP_VERSIONS, budget, out);
      }
      const tim = await itemMeta(TIM_PATH);
      if (tim && tim.ctag) await trimVersions(tim.id, KEEP_VERSIONS, budget, out);
      // 2. Backups: the newest BACKUP_KEEP, one version each.
      step('清理舊備份…');
      const backups = (await listChildren(BACKUP_FOLDER)).filter(it => !it.isFolder && isBackupName(it.name))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const it of backups.slice(0, Math.max(0, backups.length - BACKUP_KEEP))) await removeFile(BACKUP_FOLDER + '/' + it.name, it, budget, out, 'backups');
      for (const it of backups.slice(-BACKUP_KEEP)) await trimVersions(it.id, 1, budget, out);
      // 3. Exported PDFs: the newest one per Reports/<folder>, one version.
      step('清理舊的匯出 PDF…');
      for (const f of (await listChildren(EXPORTS_FOLDER)).filter(it => it.isFolder)) {
        const dir = EXPORTS_FOLDER + '/' + f.name;
        const pdfs = (await listChildren(dir)).filter(it => !it.isFolder && EXPORT_PDF.test(it.name))
          .sort((a, b) => (Date.parse(b.modified) || 0) - (Date.parse(a.modified) || 0));
        for (const it of pdfs.slice(1)) await removeFile(dir + '/' + it.name, it, budget, out, 'exports');
        if (pdfs[0]) await trimVersions(pdfs[0].id, 1, budget, out);
      }
      // 4. Pictures no report uses any more.
      step('清理不再使用的圖片…');
      await collectImageGarbage(budget, out);
    } catch (e) {
      out.error = (e && e.message) || String(e);
      out.partial = true;
    } finally {
      lsSet(LS_CLEANUP, today());
    }
    out.blocked = versionsBlocked;
    step('完成');
    return out;
  }

  /** One cleanup at a time; a request while one runs follows that run. → stats */
  function cleanupStorage(opts) {
    opts = opts || {};
    if (opts.onProgress) cleanupProgress.add(opts.onProgress);
    if (!cleaning) cleaning = runCleanup(!!opts.manual).finally(() => { cleaning = null; cleanupProgress.clear(); });
    return cleaning;
  }

  // Once a day, a little after a successful sync, in the background.
  function maybeCleanup() {
    if (cleaning || lsGet(LS_CLEANUP) === today()) return;
    setTimeout(() => {
      if (!cleaning && isEnabled() && account && !needsLogin && lsGet(LS_CLEANUP) !== today()) cleanupStorage({}).catch(() => {});
    }, 5000);
  }

  // ───────── scheduling ─────────
  /** Explicit sync (button, save, sign-in…): also uploads the report being edited right away. */
  function syncNow(opts) {
    if (!isEnabled()) return Promise.resolve();
    if (!(opts && opts.auto)) forceNext = true;
    clearTimeout(pushTimer);
    if (running) { again = true; return running; }
    const force = forceNext;
    forceNext = false;
    running = runSync(force).finally(() => {
      running = null;
      if (again) { again = false; schedulePush(500); }
    });
    return running;
  }
  const autoSync = () => syncNow({ auto: true });

  function schedulePush(ms) {
    if (!isEnabled() || !account) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(autoSync, ms == null ? PUSH_DEBOUNCE_MS : ms);
  }

  /** When the next automatic push is due: the debounce, or the end of the open report's upload gap. */
  function pushDelay() {
    const fdb = db();
    if (!fdb || !fdb.isReady()) return PUSH_DEBOUNCE_MS;
    const st = fdb.sync.state();
    if (st.deleted.length || st.tim_dirty) return PUSH_DEBOUNCE_MS;
    let wait = Infinity;
    Object.keys(st.dirty).forEach(id => {
      const gap = id === openReportId && !forceNext ? (lastPush.get(id) || 0) + OPEN_PUSH_GAP_MS - Date.now() : 0;
      wait = Math.min(wait, Math.max(PUSH_DEBOUNCE_MS, gap));
    });
    return wait === Infinity ? PUSH_DEBOUNCE_MS : wait;
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && isEnabled() && account && !needsLogin) autoSync();
    }, POLL_MS);
  }

  // Push after local saves that left something to send.
  function hookLocalWrites() {
    if (!db() || hookLocalWrites.done) return;
    hookLocalWrites.done = true;
    db().onWrite(() => {
      if (!isEnabled() || !account || running) { if (running) again = again || db().sync.hasPending(); return; }
      if (db().sync.hasPending()) schedulePush(pushDelay());
    });
  }

  const spSync = {
    config: CONFIG,
    folders: { root: CONFIG.root, reports: REPORTS_FOLDER, images: IMAGES_FOLDER, tim: TIM_PATH, backup: BACKUP_FOLDER, exports: EXPORTS_FOLDER },
    retention: { keepVersions: KEEP_VERSIONS, keepBackups: BACKUP_KEEP, openPushGapMin: OPEN_PUSH_GAP_MS / 60000, imageGcDays: IMAGE_GC_AGE_MS / 86400000 },
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

    /** The report open in the editor is never replaced by a remote version, and is uploaded at most every few minutes. */
    setOpenReport(id) {
      const prev = openReportId;
      openReportId = id || null;
      const on = isEnabled() && account;
      if (!openReportId && deferred.size) { deferred.clear(); if (on) syncNow(); return; }
      // Leaving a report: its last edits go up now, not at the end of its upload gap.
      if (on && prev && prev !== openReportId && db() && db().isReady() && db().sync.state().dirty[prev] !== undefined) schedulePush(500);
    },

    /** Upload an exported PDF to Reports/<folder>/<name> → webUrl. It replaces the older
     *  exported PDFs in that folder (they go to the site recycle bin).
     *  Not interactive: it runs after the export, too late for a sign-in popup. */
    async uploadExport(folder, name, blob) {
      await resolveSite(false);
      const safe = s => String(s || '').replace(/[\\/:*?"<>|#%]+/g, '_').trim() || 'Report';
      const dir = EXPORTS_FOLDER + '/' + safe(folder), file = safe(name);
      const res = await graph(byPath(dir + '/' + file) + ':/content',
        { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'application/pdf' } });
      const j = await res.json().catch(() => ({}));
      try {
        const budget = { left: 200 }, out = { versions: 0, versionBytes: 0, exports: 0, exportsBytes: 0 };
        for (const it of await listChildren(dir)) {
          if (!it.isFolder && it.name !== file && EXPORT_PDF.test(it.name)) await removeFile(dir + '/' + it.name, it, budget, out, 'exports');
        }
        if (j.id) await trimVersions(j.id, 1, budget, out);
      } catch (e) { /* the upload itself succeeded; the daily cleanup retries */ }
      return j.webUrl || null;
    },

    /** Link to the Thermal_Report_Builder folder in SharePoint (null until it exists). */
    async folderUrl() {
      await resolveSite(true);
      const res = await graph(byPath(CONFIG.root) + '?$select=webUrl', { interactive: true, ok: s => s === 404 });
      if (res.status === 404) return null;
      return (await res.json()).webUrl || null;
    },

    /** Remove old versions / backups / PDFs / unused pictures now. opts: { manual, onProgress(msg, stats) } → stats */
    cleanupStorage,
    cleanupRunning() { return !!cleaning; },
    lastCleanup() { return lsGet(LS_CLEANUP); },

    /** Site storage: { total, used, remaining, deleted (recycle bin), state } in bytes. */
    async quota() {
      await resolveSite(false);
      const res = await graph('/sites/' + siteId + '/drive?$select=quota');
      return (await res.json()).quota || null;
    },
    recycleBinUrl() { return 'https://' + CONFIG.siteHostname + CONFIG.sitePath + '/_layouts/15/RecycleBin.aspx'; },

    // Test seams.
    __reset() {
      pca = null; initP = null; account = null; siteId = null; needsLogin = false;
      openReportId = null; deferred.clear(); running = null; again = false; forceNext = false;
      clearTimeout(pushTimer); clearTimeout(retryTimer);
      lastPush.clear(); cleaning = null; versionsBlocked = ''; quotaWarned = false; cleanupProgress.clear();
      knownImages = null; knownImagesAt = 0; nameCache.clear(); nameCacheChars = 0;
      status = { state: 'off', message: '', lastSync: null, pending: 0 };
    },
    __idle() { return Promise.all([running, cleaning].map(p => (p ? p.catch(() => {}) : null))); },
  };

  window.spSync = spSync;
})();
