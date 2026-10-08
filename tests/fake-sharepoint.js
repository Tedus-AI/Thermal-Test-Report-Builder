'use strict';
// Test stand-ins for SharePoint: an in-memory Microsoft Graph document library routed in
// Node (Playwright context.route), and MSAL.js defined before the page loads (so the CDN
// copy is never used). Modelled on Project-TIM-management-tool's fake.
const SITE = 'site-1';
const ROOT = 'Thermal_Report_Builder';

/**
 * In-memory document library: path → { id, content: Buffer, etag, ctag, modified, by, versions }.
 * Like SharePoint, every overwrite keeps the previous content as a version, the eTag changes on
 * any change and the cTag only when the content does. Removing an old version also changes the
 * eTag here (the worst case the sync engine has to cope with).
 */
function fakeDrive() {
  // down: true → every write answers 503 (SharePoint unreachable for writes)
  // noVersionDelete: true → deleting a version answers 403 (tenant does not allow it)
  // noCtag: true → items come without a cTag
  // full: true → uploads answer 507 (site quota reached)
  const g = { files: new Map(), seq: 0, n: 0, log: [], down: false, users: {}, recycled: [], quotaTotal: 1024 * 1024 * 1024, noVersionDelete: false };
  g.put = (path, buf, by) => {
    let f = g.files.get(path);
    if (!f) { f = { id: 'item-' + (++g.seq), path, versions: [], cv: 0 }; g.files.set(path, f); }
    else f.versions.push({ id: f.cv + '.0', content: f.content, modified: f.modified, by: f.by });
    f.cv++;
    f.content = buf; f.etag = '"{' + f.id + '},' + (++g.n) + '"'; f.ctag = '"c:{' + f.id + '},' + f.cv + '"';
    f.modified = new Date().toISOString(); f.by = by || 'Someone';
    return f;
  };
  g.remove = path => {
    const f = g.files.get(path);
    if (!f) return;
    g.recycled.push({ path, size: f.content.length + f.versions.reduce((s, v) => s + v.content.length, 0) });
    g.files.delete(path);
  };
  g.text = path => (g.files.get(path) ? g.files.get(path).content.toString('utf8') : null);
  g.json = path => JSON.parse(g.text(path));
  // A colleague writes a report file directly on SharePoint (old self-contained format).
  g.putReport = (id, report, by) => g.put(`${ROOT}/Database/reports/${id}.json`,
    Buffer.from(JSON.stringify({ format: 'thermal-report-v1', id, report })), by || 'Colleague B');
  g.report = id => { const t = g.text(`${ROOT}/Database/reports/${id}.json`); return t ? JSON.parse(t).report : null; };
  g.reportFile = id => { const t = g.text(`${ROOT}/Database/reports/${id}.json`); return t ? JSON.parse(t) : null; };
  // The report with its pictures put back (what a client reads).
  g.reportFull = id => {
    const rep = g.report(id);
    const MIME = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };
    const walk = v => {
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.$img === 'string' && Object.keys(v).length === 1) {
        const f = g.files.get(`${ROOT}/Database/images/${v.$img}`);
        return f ? `data:${MIME[v.$img.split('.').pop()]};base64,` + f.content.toString('base64') : null;
      }
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach(k => { o[k] = walk(v[k]); }); return o; }
      return v;
    };
    return rep && walk(rep);
  };
  g.reportIds = () => Array.from(g.files.keys())
    .filter(k => k.startsWith(`${ROOT}/Database/reports/`))
    .map(k => k.split('/').pop().replace(/\.json$/, ''));
  g.images = () => Array.from(g.files.keys()).filter(k => k.startsWith(`${ROOT}/Database/images/`)).map(k => k.split('/').pop()).sort();
  g.inFolder = folder => Array.from(g.files.keys()).filter(k => k.startsWith(`${ROOT}/${folder}/`)).map(k => k.slice(ROOT.length + folder.length + 2)).sort();
  g.versions = path => (g.files.get(path) ? g.files.get(path).versions.length + 1 : 0);
  // backdate a file (e.g. an old picture for the cleanup)
  g.age = (path, days) => { const f = g.files.get(path); f.modified = new Date(Date.now() - days * 86400000).toISOString(); };
  // upload paths look like …/root:/<path>:/content
  g.puts = suffix => g.log.filter(l => l.method === 'PUT' && l.p.replace(/:\/content$/, '').endsWith(suffix)).length;
  g.used = () => Array.from(g.files.values()).reduce((s, f) => s + f.content.length + f.versions.reduce((t, v) => t + v.content.length, 0), 0);
  return g;
}

async function routeGraph(context, g) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS', 'Access-Control-Expose-Headers': '*' };
  const json = (route, status, obj) => route.fulfill({ status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors), body: JSON.stringify(obj) });
  const who = f => ({ user: { displayName: f.by } });
  const meta = f => ({ id: f.id, name: f.path.split('/').pop(), eTag: f.etag, cTag: g.noCtag ? undefined : f.ctag, size: f.content.length, lastModifiedDateTime: f.modified, lastModifiedBy: who(f), webUrl: 'https://sharepoint.test/' + encodeURI(f.path), file: {} });
  const notFound = route => json(route, 404, { error: { code: 'itemNotFound', message: 'The resource could not be found.' } });
  await context.route(/^https:\/\/graph\.microsoft\.com\//, async route => {
    const req = route.request();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    const p = decodeURIComponent(u.pathname).replace(/^\/v1\.0/, '');
    const auth = req.headers()['authorization'] || '';
    g.log.push({ method, p, ifMatch: req.headers()['if-match'] || null, query: u.search });
    if (!/^Bearer tok-/.test(auth)) return json(route, 401, { error: { code: 'InvalidAuthenticationToken', message: 'no token' } });
    const userName = g.users[auth.replace(/^Bearer tok-/, '')] || 'Tester A';
    if (p === '/sites/deltao365.sharepoint.com:/sites/Thermal-Spec-DB') return json(route, 200, { id: SITE });
    if (g.down && method !== 'GET') return json(route, 503, { error: { code: 'serviceNotAvailable', message: 'Service unavailable' } });
    if (p === '/sites/site-1/drive') {
      const used = g.used(), deleted = g.recycled.reduce((s, r) => s + r.size, 0);
      return json(route, 200, { id: 'drive-1', quota: { total: g.quotaTotal, used: used + deleted, remaining: g.quotaTotal - used - deleted, deleted, state: 'normal' } });
    }
    // Version history: /drive/items/{id}/versions[/{versionId}]
    const vm = /^\/sites\/site-1\/drive\/items\/([^/]+)\/versions(?:\/([^/]+))?$/.exec(p);
    if (vm) {
      const f = Array.from(g.files.values()).find(x => x.id === vm[1]);
      if (!f) return notFound(route);
      if (method === 'GET' && !vm[2]) {
        const list = [{ id: f.cv + '.0', size: f.content.length, lastModifiedDateTime: f.modified, lastModifiedBy: who(f) }]
          .concat(f.versions.slice().reverse().map(v => ({ id: v.id, size: v.content.length, lastModifiedDateTime: v.modified, lastModifiedBy: { user: { displayName: v.by } } })));
        return json(route, 200, { value: list });
      }
      if (method === 'DELETE' && vm[2]) {
        if (g.noVersionDelete) return json(route, 403, { error: { code: 'accessDenied', message: 'Access denied' } });
        if (vm[2] === f.cv + '.0') return json(route, 400, { error: { code: 'invalidRequest', message: 'The current version cannot be deleted' } });
        const i = f.versions.findIndex(v => v.id === vm[2]);
        if (i < 0) return notFound(route);
        g.recycled.push({ path: f.path + '#' + vm[2], size: f.versions[i].content.length });
        f.versions.splice(i, 1);
        f.etag = '"{' + f.id + '},' + (++g.n) + '"';      // metadata changed, content (cTag) did not
        return route.fulfill({ status: 204, headers: cors });
      }
      return json(route, 400, { error: { code: 'badRequest', message: 'unhandled ' + method + ' ' + p } });
    }
    const m = /^\/sites\/site-1\/drive\/root:\/(.+?)(?::\/(content|children))?$/.exec(p);
    if (!m) return json(route, 400, { error: { code: 'badRequest', message: 'unhandled ' + method + ' ' + p } });
    const path = m[1], what = m[2] || 'meta';
    if (what === 'children') {
      const items = [], folders = new Map();
      for (const f of g.files.values()) {
        if (!f.path.startsWith(path + '/')) continue;
        const rest = f.path.slice(path.length + 1);
        if (!rest.includes('/')) items.push(meta(f));
        else {
          const name = rest.split('/')[0];
          if (!folders.has(name)) folders.set(name, { id: 'folder:' + path + '/' + name, name, size: 0, lastModifiedDateTime: f.modified, webUrl: 'https://sharepoint.test/' + encodeURI(path + '/' + name), folder: { childCount: 0 } });
        }
      }
      const all = items.concat(Array.from(folders.values()));
      return all.length ? json(route, 200, { value: all }) : notFound(route);
    }
    const f = g.files.get(path);
    if (method === 'GET') {
      if (what === 'meta' && !f) {
        const isFolder = Array.from(g.files.keys()).some(k => k.startsWith(path + '/'));
        return isFolder ? json(route, 200, { id: 'folder', name: path.split('/').pop(), webUrl: 'https://sharepoint.test/' + encodeURI(path), folder: {} }) : notFound(route);
      }
      if (!f) return notFound(route);
      return what === 'content' ? route.fulfill({ status: 200, headers: cors, body: f.content }) : json(route, 200, meta(f));
    }
    const im = req.headers()['if-match'];
    if (method === 'PUT' && g.full) return json(route, 507, { error: { code: 'quotaLimitReached', message: 'Insufficient Space Available' } });
    if (method === 'PUT') {
      if (f && /conflictBehavior=fail/.test(u.search)) return json(route, 409, { error: { code: 'nameAlreadyExists', message: 'exists' } });
      if (im && (!f || im !== f.etag)) return json(route, 412, { error: { code: 'resourceModified', message: 'ETag does not match' } });
      return json(route, f ? 200 : 201, meta(g.put(path, req.postDataBuffer() || Buffer.alloc(0), userName)));
    }
    if (method === 'DELETE') {
      if (!f) return notFound(route);
      if (im && im !== f.etag) return json(route, 412, { error: { code: 'resourceModified', message: 'ETag does not match' } });
      g.remove(path);
      return route.fulfill({ status: 204, headers: cors });
    }
    return json(route, 400, { error: { code: 'badRequest', message: 'unhandled ' + method } });
  });
}

/** MSAL stand-in: account in localStorage (like the real cache); window.__expired makes silent token calls fail. */
function fakeMsal() {
  const key = '__fake_msal_account';
  window.msal = {
    PublicClientApplication: class {
      constructor(cfg) { window.__msalConfig = cfg; }
      async initialize() {}
      async handleRedirectPromise() { return null; }
      getAllAccounts() { const a = localStorage.getItem(key); return a ? [JSON.parse(a)] : []; }
      async loginPopup() {
        window.__logins = (window.__logins || 0) + 1;
        const acc = window.__nextAccount || { name: 'Tester A', username: 'tester.a@example.test' };
        localStorage.setItem(key, JSON.stringify(acc));
        return { account: acc };
      }
      async acquireTokenSilent(req) {
        if (window.__expired) throw Object.assign(new Error('interaction required'), { errorCode: 'interaction_required' });
        return { accessToken: 'tok-' + req.account.username };
      }
      async acquireTokenPopup(req) { window.__expired = false; return { accessToken: 'tok-' + req.account.username, account: req.account }; }
    },
  };
  // The daily background cleanup counts as done, so tests see only what they trigger
  // themselves (a test clears this key to exercise the automatic run).
  if (!sessionStorage.getItem('__keep_cleanup_key')) {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    localStorage.setItem('thermal_sp_last_cleanup', `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  }
}

async function setup(context, g) {
  await context.addInitScript(fakeMsal);
  await routeGraph(context, g);
}

module.exports = { SITE, fakeDrive, routeGraph, fakeMsal, setup };
