'use strict';
// Test stand-ins for SharePoint: an in-memory Microsoft Graph document library routed in
// Node (Playwright context.route), and MSAL.js defined before the page loads (so the CDN
// copy is never used). Modelled on Project-TIM-management-tool's fake.
const SITE = 'site-1';

/** In-memory document library: path → { id, content: Buffer, etag, modified, by }. */
function fakeDrive() {
  // down: true → every write answers 503 (SharePoint unreachable for writes)
  const g = { files: new Map(), seq: 0, n: 0, log: [], down: false, users: {} };
  g.put = (path, buf, by) => {
    let f = g.files.get(path);
    if (!f) { f = { id: 'item-' + (++g.seq), path }; g.files.set(path, f); }
    f.content = buf; f.etag = '"{' + f.id + '},' + (++g.n) + '"'; f.modified = new Date().toISOString(); f.by = by || 'Someone';
    return f;
  };
  g.text = path => (g.files.get(path) ? g.files.get(path).content.toString('utf8') : null);
  g.json = path => JSON.parse(g.text(path));
  // A colleague writes a report file directly on SharePoint.
  g.putReport = (id, report, by) => g.put(`Thermal_Report_Builder/Database/reports/${id}.json`,
    Buffer.from(JSON.stringify({ format: 'thermal-report-v1', id, report })), by || 'Colleague B');
  g.report = id => { const t = g.text(`Thermal_Report_Builder/Database/reports/${id}.json`); return t ? JSON.parse(t).report : null; };
  g.reportIds = () => Array.from(g.files.keys())
    .filter(k => k.startsWith('Thermal_Report_Builder/Database/reports/'))
    .map(k => k.split('/').pop().replace(/\.json$/, ''));
  // upload paths look like …/root:/<path>:/content
  g.puts = suffix => g.log.filter(l => l.method === 'PUT' && l.p.replace(/:\/content$/, '').endsWith(suffix)).length;
  return g;
}

async function routeGraph(context, g) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS', 'Access-Control-Expose-Headers': '*' };
  const json = (route, status, obj) => route.fulfill({ status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors), body: JSON.stringify(obj) });
  const who = f => ({ user: { displayName: f.by } });
  const meta = f => ({ id: f.id, name: f.path.split('/').pop(), eTag: f.etag, size: f.content.length, lastModifiedDateTime: f.modified, lastModifiedBy: who(f), webUrl: 'https://sharepoint.test/' + encodeURI(f.path), file: {} });
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
    const m = /^\/sites\/site-1\/drive\/root:\/(.+?)(?::\/(content|children))?$/.exec(p);
    if (!m) return json(route, 400, { error: { code: 'badRequest', message: 'unhandled ' + method + ' ' + p } });
    const path = m[1], what = m[2] || 'meta';
    if (what === 'children') {
      const items = Array.from(g.files.values()).filter(f => f.path.startsWith(path + '/') && !f.path.slice(path.length + 1).includes('/'));
      return items.length ? json(route, 200, { value: items.map(meta) }) : notFound(route);
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
    if (method === 'PUT') {
      if (f && /conflictBehavior=fail/.test(u.search)) return json(route, 409, { error: { code: 'nameAlreadyExists', message: 'exists' } });
      if (im && (!f || im !== f.etag)) return json(route, 412, { error: { code: 'resourceModified', message: 'ETag does not match' } });
      return json(route, f ? 200 : 201, meta(g.put(path, req.postDataBuffer() || Buffer.alloc(0), userName)));
    }
    if (method === 'DELETE') {
      if (!f) return notFound(route);
      if (im && im !== f.etag) return json(route, 412, { error: { code: 'resourceModified', message: 'ETag does not match' } });
      g.files.delete(path);
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
}

async function setup(context, g) {
  await context.addInitScript(fakeMsal);
  await routeGraph(context, g);
}

module.exports = { SITE, fakeDrive, routeGraph, fakeMsal, setup };
