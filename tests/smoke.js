// Headless regression tests for Thermal Test Report Builder.
//
// Runs index.html in Chromium (Playwright) against an in-memory fake database
// file (fileDb test seams), so no real report data is ever touched.
//
//   npm install --no-save playwright && npx playwright install chromium
//   node tests/smoke.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const fakeSp = require('./fake-sharepoint');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css' };

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Injected into the page: fake file handle + data helpers.
const SETUP = () => {
  let tick = 1;
  window.makeHandle = (name, text) => {
    const h = { name, kind: 'file', _text: text, _mtime: tick++, writes: 0,
      async getFile() { const t = h._text; return { text: async () => t, lastModified: h._mtime, size: t.length }; },
      async createWritable() {
        let buf = '';
        return {
          write: async (s) => { buf += (typeof s === 'string') ? s : await s.text(); },
          close: async () => { h._text = buf; h._mtime = tick++; h.writes++; },
          abort: async () => {},
        };
      },
      async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; } };
    return h;
  };
  // Open `obj` as the database exactly like a real file open would.
  window.useDb = async (obj) => {
    const h = window.makeHandle('db.json', JSON.stringify(obj));
    const r = await fileDb._open(h);
    window.__h = h;
    if (r.success) setDbState('ready', h.name);
    return r;
  };
  window.sleep = (ms) => new Promise(r => setTimeout(r, ms));
  window.disk = () => JSON.parse(window.__h._text);
  window.cover = (name) => ({ type: 'cover', order: 0, data: { project_name: name, model: 'M', stage: 'DVT', tested_by: '', date: '2026-01-01', dept: 'DEPT-' + name, report_version: 'v1.0', cover_image: '' } });
  window.report = (name, pages) => ({ project_name: name, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', pages });
  window.comp = (name, readings, spec = 125, derating = '0.90', extra = {}) => ({ category: 'RF', name, spec_type: 'Abs.', tc_spec: String(spec), derating, tim_type: '', readings, note: '', ...extra });
  window.dataPage = (order, comps, tas = [25, 55], extra = {}) => ({ type: 'data', order, data: { header: { stage: 'DVT' }, ta_conditions: tas, components: comps, sensors: [], ...extra } });
  window.tds = (sel) => Array.from(document.querySelectorAll(sel)).map(td => td.textContent.trim());
  window.__alerts = [];
  window.alert = (m) => { window.__alerts.push(String(m)); };
};

const results = [];
async function test(browser, name, fn, opts = {}) {
  // SMOKE_ONLY=<substring> runs just the matching tests (local iteration)
  if (process.env.SMOKE_ONLY && !name.includes(process.env.SMOKE_ONLY)) return;
  const { __clock, __setup, ...ctxOpts } = opts;
  const ctx = await browser.newContext(ctxOpts);
  if (__setup) await __setup(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? (page.__prompt || '') : undefined));
  try {
    if (__clock) await page.clock.setFixedTime(__clock);
    await page.goto(page.__url, { waitUntil: 'load' });
    await page.waitForTimeout(200);
    await page.evaluate(SETUP);
    const detail = await fn(page);
    if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
    results.push({ name, ok: true });
    console.log(`  ✔ ${name}`);
    return detail;
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`  ✘ ${name}\n      ${e.message}`);
  } finally {
    await ctx.close();
  }
}
const assert = (cond, msg, detail) => { if (!cond) throw new Error(msg + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')); };

(async () => {
  const server = await startServer();
  const URL = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  const T = (name, fn, opts = {}) => test(browser, name, async (page) => fn(page), opts);
  // SharePoint scenario: fresh in-memory Graph + fake MSAL per test.
  const SP = (name, fn) => { const g = fakeSp.fakeDrive(); return T(name, page => fn(page, g), { __setup: ctx => fakeSp.setup(ctx, g) }); };
  // Make the page URL available to test()
  const origNewContext = browser.newContext.bind(browser);
  browser.newContext = async (o) => { const c = await origNewContext(o); const orig = c.newPage.bind(c); c.newPage = async () => { const p = await orig(); p.__url = URL; return p; }; return c; };

  console.log('Storage / data integrity');

  await T('undo history does not leak between reports', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }), B: report('B', { 0: cover('B') }) } });
      await openReport('A');
      const inp = document.querySelector('[data-field="dept"]');
      inp.value = 'EDITED-IN-A'; inp.dispatchEvent(new Event('input'));
      await leaveEditor();
      await openReport('B');
      const undoEnabled = !document.getElementById('btn-undo').disabled;
      performUndo();
      await flushAllSaves();
      return { undoEnabled, bName: disk().thermal_reports.B.pages['0'].data.project_name, aDept: disk().thermal_reports.A.pages['0'].data.dept };
    });
    assert(!r.undoEnabled && r.bName === 'B' && r.aDept === 'EDITED-IN-A', 'cross-report undo', r);
  });

  await T('corrupt database file is refused, never overwritten', async (page) => {
    const r = await page.evaluate(async () => {
      const good = JSON.stringify({ thermal_reports: { A: report('A', { 0: cover('A') }) } });
      const h = makeHandle('db.json', good.slice(0, -5));
      const res = await fileDb._open(h);
      return { res, ready: fileDb.isReady(), untouched: h._text === good.slice(0, -5), writes: h.writes };
    });
    assert(r.res.reason === 'parse-error' && !r.ready && r.untouched && r.writes === 0, 'parse failure handling', r);
  });

  await T('empty file opens as a new empty database', async (page) => {
    const r = await page.evaluate(async () => {
      const h = makeHandle('new.json', '');
      const res = await fileDb._open(h);
      return { ok: res.success, reports: (await fileDb.getAllReports()).length };
    });
    assert(r.ok && r.reports === 0, 'empty file', r);
  });

  await T('external change to the file blocks saving (no silent overwrite)', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }) } });
      await openReport('A');
      await flushAllSaves();
      // Another tab / colleague writes the file
      __h._text = JSON.stringify({ thermal_reports: { A: report('A', { 0: cover('A') }), X: report('X', {}) } });
      __h._mtime += 1000;
      const inp = document.querySelector('[data-field="dept"]');
      inp.value = 'MINE'; inp.dispatchEvent(new Event('input'));
      await flushAllSaves();
      return { conflict: fileDb.hasConflict(), keptOther: !!disk().thermal_reports.X, dialog: !!document.querySelector('[data-cf="reload"]'), status: document.getElementById('status-text').textContent };
    });
    assert(r.conflict && r.keptOther && r.dialog && r.status.includes('未儲存'), 'conflict detection', r);
  });

  await T('TIM library is preserved when creating a report first', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: {}, tim_library: { grease: [], pad: [{ name: 'PadA' }, { name: 'PadB' }], putty: [] } });
      await createNewReport('X', 'M', 'DVT', '2026-10-06');
      addDataPage();
      document.getElementById('tim-add-btn').click();
      await flushAllSaves();
      return disk().tim_library;
    });
    assert(r.pad.length === 2 && r.grease.length === 1, 'TIM library', r);
  });

  await T('leaving the editor within the debounce still saves', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }) } });
      await openReport('A');
      addImagePage();
      const t = document.getElementById('im-title');
      t.value = 'IR images'; t.dispatchEvent(new Event('input'));
      await leaveEditor();
      const pages = disk().thermal_reports.A.pages;
      return { n: Object.keys(pages).length, title: pages['1'] && pages['1'].data.title };
    });
    assert(r.n === 2 && r.title === 'IR images', 'flush on leave', r);
  });

  await T('saving into a report missing from the open DB reports an error', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }) } });
      await openReport('A');
      await flushAllSaves();
      fileDb.__setDbCacheForTest({ thermal_reports: { OTHER: report('OTHER', {}) } });
      const inp = document.querySelector('[data-field="dept"]');
      inp.value = 'X'; inp.dispatchEvent(new Event('input'));
      await flushAllSaves();
      return document.getElementById('status-text').textContent;
    });
    assert(r.includes('未儲存'), 'missing report status', r);
  });

  await T('reports with more than 50 pages load completely; ids persist', async (page) => {
    const r = await page.evaluate(async () => {
      const pages = {};
      for (let i = 0; i < 55; i++) pages[i] = { type: 'note', order: i, data: { title: 'n' + i, blocks: [] } };
      await useDb({ thermal_reports: { A: report('A', pages) } });
      await openReport('A');
      await flushAllSaves();
      const stored = Object.values(disk().thermal_reports.A.pages);
      return { loaded: state.pages.length, idsStored: stored.every(p => p.id), unique: new Set(stored.map(p => p.id)).size };
    });
    assert(r.loaded === 55 && r.idsStored && r.unique === 55, '>50 pages', r);
  });

  await T('delete / reorder keep selection and write one consistent page list', async (page) => {
    const r = await page.evaluate(async () => {
      const pages = {};
      for (let i = 0; i < 5; i++) pages[i] = { type: 'note', order: i, data: { title: 'n' + i, blocks: [] } };
      await useDb({ thermal_reports: { A: report('A', pages) } });
      await openReport('A');
      selectPage(3);
      contextTarget = 1;
      document.getElementById('context-delete').click();
      await flushAllSaves();
      const titles = Object.keys(disk().thermal_reports.A.pages).sort((a, b) => a - b).map(k => disk().thermal_reports.A.pages[k].data.title);
      return { active: state.pages[state.activePage].data.title, titles, undo: !document.getElementById('btn-undo').disabled };
    });
    assert(r.active === 'n3' && r.titles.join() === 'n0,n2,n3,n4' && !r.undo, 'delete page', r);
  });

  await T('auto-backup never replaces a much larger same-day backup', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: {} });
      const files = {};
      const today = localDateStr();
      files[`thermal_reports_backup_${today}.json`] = 'x'.repeat(50000);
      const dir = {
        name: 'bk',
        async queryPermission() { return 'granted'; },
        async getFileHandle(n, o) {
          if (!(n in files) && !(o && o.create)) throw new Error('NotFound');
          return { async getFile() { return { size: (files[n] || '').length }; },
                   async createWritable() { let b = ''; return { write: async (x) => { b += typeof x === 'string' ? x : await x.text(); }, close: async () => { files[n] = b; } }; } };
        },
        async *entries() { for (const n of Object.keys(files)) yield [n, { kind: 'file' }]; },
        async removeEntry(n) { delete files[n]; },
      };
      fileDb.__setBackupDirForTest(dir);
      const res = await fileDb.writeAutoBackup();
      return { res, bigKept: files[`thermal_reports_backup_${today}.json`].length === 50000, names: Object.keys(files) };
    });
    assert(r.res.success && r.bigKept && r.names.length === 2, 'backup shrink guard', r);
  });

  console.log('Report correctness');

  await T('比對頁: links survive row deletion (no mixed name/value)', async (page) => {
    const r = await page.evaluate(async () => {
      const sim = { type: 'sim_vs_meas', order: 1, data: { items: [{ category: 'RF', component_name: 'PA_U2', sim_tc: '92', source_page: 'page_loaded_0', source_idx: 1 }, { category: 'RF', component_name: 'PA_U1', sim_tc: '70' }] } };
      await useDb({ thermal_reports: { A: report('A', { 0: dataPage(0, [comp('PA_U1', { ta_55: '70' }), comp('PA_U2', { ta_55: '90' }), comp('FPGA_U1', { ta_55: '50' })]), 1: sim }) } });
      await openReport('A');
      selectPage(0);
      document.querySelector('[data-del-row="0"]').click();   // delete PA_U1
      selectPage(1);
      const rows = Array.from(document.querySelectorAll('#sim-tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()));
      return { row0: rows[0].slice(1, 5), row1: rows[1].slice(1, 5) };
    });
    assert(r.row0[0] === 'PA_U2' && r.row0[3] === '90.0', 'PA_U2 keeps its own Meas Tc', r);
    assert(/來源元件已變更/.test(r.row1[0]) && r.row1[3] === '—', 'deleted source shows as stale', r);
  });

  await T('比對頁: user-selected Ta, labelled, no silent fallback', async (page) => {
    const r = await page.evaluate(async () => {
      const sim = { type: 'sim_vs_meas', order: 2, data: { items: [] } };
      await useDb({ thermal_reports: { A: report('A', {
        0: dataPage(0, [comp('PA_U1', { ta_25: '60', ta_55: '90' }), comp('PA_U2', { ta_25: '61' })]),
        1: dataPage(1, [comp('DDR', { ta_45: '70' })], [25, 45]),
        2: sim }) } });
      await openReport('A');
      const all = getDataPageComponents();
      state.pages[2].data.items = all.map(c => ({ category: c.category, component_name: c.component_name, sim_tc: '', source_page: c.source_page, source_uid: c.source_uid }));
      selectPage(2);
      const at55 = { head: tds('.sim-table thead th').slice(3, 5), meas: Array.from(document.querySelectorAll('#sim-tbody tr')).map(tr => tr.children[4].textContent.trim()) };
      const sel = document.getElementById('sim-compare-ta');
      sel.value = '25'; sel.dispatchEvent(new Event('change'));
      const at25 = { head: tds('.sim-table thead th').slice(3, 5), meas: Array.from(document.querySelectorAll('#sim-tbody tr')).map(tr => tr.children[4].textContent.trim()), stored: state.pages[2].data.compare_ta };
      const pdf = buildSimVsMeasPagesHTML(state.pages[2].data)[0];
      return { at55, at25, pdfLabel: pdf.includes('Meas Tc @ 25°C') };
    });
    assert(r.at55.head.join('|') === 'Sim Tc @ 55°C|Meas Tc @ 55°C' && r.at55.meas.join('|') === '90.0|—|無此 Ta', 'Ta=55 view', r);
    assert(r.at25.stored === 25 && r.at25.meas.join('|') === '60.0|61.0|—' && r.pdfLabel, 'Ta=25 view', r);
  });

  await T('結論頁: Max Tc is the max over all Ta; overall uses every data-page component', async (page) => {
    const r = await page.evaluate(async () => {
      const concl = { type: 'conclusion', order: 1, data: { summary: '', issues: [''], actions: [], compliance: [{ component: 'PA_U1' }] } };
      await useDb({ thermal_reports: { A: report('A', { 0: dataPage(0, [comp('PA_U1', { ta_25: '80', ta_55: '100', ta_65: '115' }), comp('LNA', { ta_65: '60' })], [25, 55, 65]), 1: concl }) } });
      await openReport('A');
      selectPage(1);
      const row = tds('#compliance-tbody tr:not(.concl-group-row) td').slice(0, 5);
      const overall = document.querySelector('.concl-overall-value').textContent.trim();
      const pdf = buildConclusionPagesHTML(state.pages[1].data).join("");
      return { row, overall, pdfFail: pdf.includes('❌ FAIL'), linked: !!state.pages[1].data.compliance[0].source_uid };
    });
    assert(r.row[1].startsWith('115.0') && r.row[1].includes('65°C') && r.row[4].includes('Fail'), 'compliance max Tc', r);
    assert(r.overall.includes('FAIL') && r.pdfFail && r.linked, 'overall', r);
  });

  await T('結論頁: empty Compliance Summary cannot hide a data-page Fail', async (page) => {
    const r = await page.evaluate(async () => {
      const concl = { type: 'conclusion', order: 1, data: { summary: '', issues: [''], actions: [], compliance: [] } };
      await useDb({ thermal_reports: { A: report('A', { 0: dataPage(0, [comp('PA_U1', { ta_55: '130' })]), 1: concl }) } });
      await openReport('A');
      selectPage(1);
      return { overall: document.querySelector('.concl-overall-value').textContent.trim(), hint: !!document.getElementById('concl-flag-hint') };
    });
    assert(r.overall.includes('FAIL') && r.hint, 'overall with empty summary', r);
  });

  await T('數據頁: unmeasured row is not "Pass"; ΔT margin + definitions shown', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: dataPage(0, [comp('NOREAD', {}), comp('PA', { ta_55: '100' })]) }) } });
      await openReport('A');
      const pf = Array.from(document.querySelectorAll('#dt-tbody tr')).map(tr => tr.querySelector('[class^="dt-passfail"]').textContent.trim());
      const margin = document.querySelectorAll('#dt-tbody tr')[1].children[11].textContent.trim();
      const pdf = buildDataPagePagesHTML(state.pages[0].data)[0];
      return { pf, margin, note: !!document.querySelector('.dt-def-note'), pdfDelta: pdf.includes('ΔT 12.5°C'), pdfDef: pdf.includes('ΔT Margin(°C)') };
    });
    assert(r.pf[0] === '—' && r.pf[1] === '✔ Pass', 'P/F', r);
    assert(r.margin === '11.1%ΔT 12.5°C' && r.note && r.pdfDelta && r.pdfDef, 'ΔT margin', r);
  });

  await T('數據頁: 4 Ta conditions still fit the A4 landscape width in PDF', async (page) => {
    const r = await page.evaluate(async () => {
      const comps = ['PA_GaN_U1_Main', 'FPGA_U1_ZU47DR', 'DDR4_U5', 'DCDC_48V_U3'].map(n => ({ ...comp(n, { ta_25: '70.1', ta_45: '80.2', ta_55: '90.3', ta_65: '99.4' }), tim_type: 'Coolzorb K=11.5', note: 'Near fan outlet, retest' }));
      const html = buildDataPagePagesHTML({ header: {}, ta_conditions: [25, 45, 55, 65], components: comps, sensors: [] })[0];
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:-9999px;top:0;width:842px;height:595px;overflow:hidden;';
      box.innerHTML = html; document.body.appendChild(box);
      const tables = box.querySelectorAll('table');
      const w = Math.round(tables[tables.length - 1].getBoundingClientRect().width);
      box.remove();
      return { w };
    });
    assert(r.w <= 778, 'table width', r);
  });

  await T('數據頁: grid paste validates numbers / options and escapes output', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: dataPage(0, [comp('PA_U1', {})]) }) } });
      await openReport('A');
      const cell = document.querySelector('[data-ta-key="ta_25"]');
      const dt = new DataTransfer(); dt.setData('text/plain', '85.3°C\t<b>X</b>');
      cell.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      const cat = document.querySelector('[data-comp-field="category"]');
      const dt2 = new DataTransfer(); dt2.setData('text/plain', 'digital\tNAME\tabs\t125\t0.9');
      cat.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt2, bubbles: true, cancelable: true }));
      const c = state.pages[0].data.components[0];
      const html = buildDataPagePagesHTML(state.pages[0].data)[0];
      return { readings: c.readings, cat: c.category, spec: c.spec_type, der: c.derating, derSel: document.querySelector('[data-comp-field="derating"]').value, editor: document.querySelector('[data-ta-key="ta_25"]').value, raw: html.includes('<b>X</b>'), alerts: __alerts.length };
    });
    assert(r.readings.ta_25 === '85.3' && r.readings.ta_55 === undefined && r.editor === '85.3' && !r.raw && r.alerts === 1, 'numeric paste', r);
    assert(r.cat === 'Digital' && r.spec === 'Abs.' && r.der === '0.90' && r.derSel === '0.90', 'option paste', r);
  });

  await T('數據頁: duplicate Ta rejected; frozen page locks delete and Ta edit', async (page) => {
    page.__prompt = '55';
    const r = await page.evaluate(async () => {
      const dp = dataPage(0, [comp('PA_U1', { ta_55: '90' }), comp('PA_U2', { ta_55: '91' })]);
      await useDb({ thermal_reports: { A: report('A', { 0: dp }) } });
      await openReport('A');
      document.getElementById('ta-add-btn').click();
      const ta = state.pages[0].data.ta_conditions.slice();
      document.getElementById('data-freeze-btn').click();
      const td = document.querySelector('#dt-tbody tr td.dt-readonly');
      td.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      document.querySelector('.ta-tag-temp').click();
      return { ta, comps: state.pages[0].data.components.length, taEditor: !!document.querySelector('.ta-tag-edit') };
    });
    assert(r.ta.join() === '25,55' && r.comps === 2 && !r.taEditor, 'duplicate Ta / frozen', r);
  });

  await T('比對頁: Dev% uses the temperature rise (Meas − Ta) with 10/20% + 2/4°C rule', async (page) => {
    const r = await page.evaluate(async () => {
      const sim = { type: 'sim_vs_meas', order: 1, data: { compare_ta: 55, items: [] } };
      await useDb({ thermal_reports: { A: report('A', { 0: dataPage(0, [
        comp('PA', { ta_55: '99.1' }), comp('FPGA', { ta_55: '89.2' }, 100), comp('LOWRISE', { ta_55: '60' }), comp('BAD', { ta_55: '80' })]), 1: sim }) } });
      await openReport('A');
      const all = getDataPageComponents();
      const sims = ['102.1', '95.3', '61.5', '95'];
      state.pages[1].data.items = all.map((c, i) => ({ category: c.category, component_name: c.component_name, sim_tc: sims[i], source_page: c.source_page, source_uid: c.source_uid }));
      selectPage(1);
      const rows = Array.from(document.querySelectorAll('#sim-tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim()));
      const notes = document.querySelector('.sim-notes-block').textContent;
      const pdf = buildSimVsMeasPagesHTML(state.pages[1].data)[0];
      return { rows: rows.map(r => r.slice(5, 9)), head: tds('.sim-table thead th')[5], notes, pdfFormula: pdf.includes('(Sim Tc − Meas Tc) / (Meas Tc − Ta) × 100') };
    });
    // [Meas ΔT, Dev°C, Dev%, judge]
    assert(r.head === 'Meas ΔT (°C)', 'Meas ΔT column', r);
    assert(r.rows[0].join('|') === '44.1|3.0|6.8%|✅', 'PA', r.rows[0]);
    assert(r.rows[1].join('|') === '34.2|6.1|17.8%|⚠️', 'FPGA', r.rows[1]);
    assert(r.rows[2].join('|') === '5.0|1.5|30.0%|✅', 'low-rise floor', r.rows[2]);
    assert(r.rows[3].join('|') === '25.0|15.0|60.0%|❌', 'bad', r.rows[3]);
    assert(r.notes.includes('(Sim Tc − Meas Tc) / (Meas Tc − Ta) × 100') && r.notes.includes('|Dev%| ≤ 10% 或 |Dev| ≤ 2°C') && r.pdfFormula, 'formula notes', r.notes);
  });

  await T('結論頁: results, compliance rows and hints are grouped per data page', async (page) => {
    const r = await page.evaluate(async () => {
      const concl = { type: 'conclusion', order: 2, data: { summary: '', issues: [''], actions: [], compliance: [] } };
      await useDb({ thermal_reports: { A: report('A', {
        0: dataPage(0, [comp('U1', { ta_55: '120' }), comp('U2', { ta_55: '108' }), comp('U3', { ta_55: '60' })], [25, 55], {}),
        1: dataPage(1, [comp('U1', { ta_55: '90' }), comp('U2', { ta_55: '106' })]),
        2: concl }) } });
      state.pages = []; // no-op guard
      await openReport('A');
      state.pages[1].data.list_note = '加風扇';
      selectPage(2);
      const out = {};
      out.conditions = tds('.concl-section .concl-table tbody')[0];
      out.groups = Array.from(document.querySelectorAll('.concl-hint-group .concl-hint-label')).map(e => e.firstChild.textContent.trim());
      out.chips = Array.from(document.querySelectorAll('.concl-hint-group')).map(g => g.querySelectorAll('.concl-chip').length);
      document.querySelector('.concl-chip').click();                       // add one (page 1 U1)
      out.afterChip = state.pages[2].data.compliance.length;
      document.querySelector('[data-add-page]:last-of-type') && document.querySelectorAll('[data-add-page]')[1].click(); // add all of page 2
      out.afterPage = state.pages[2].data.compliance.length;
      out.groupRows = tds('#compliance-tbody tr.concl-group-row td');
      document.getElementById('concl-hint-close').click();
      out.hintGone = !document.getElementById('concl-flag-hint');
      out.reopen = (document.getElementById('concl-show-flagged') || {}).textContent;
      document.getElementById('concl-show-flagged').click();
      out.hintBack = !!document.getElementById('concl-flag-hint');
      const th = document.querySelectorAll('#compliance-tbody')[0].closest('table').querySelectorAll('thead th');
      out.align = [getComputedStyle(th[0]).textAlign, getComputedStyle(th[1]).textAlign];
      return out;
    });
    assert(r.conditions.startsWith('數據頁 1') && r.conditions.includes('數據頁 2 · 加風扇') && r.conditions.includes('FAIL'), 'condition table', r.conditions);
    assert(r.groups.length === 2 && r.groups[0].startsWith('數據頁 1') && r.groups[1].includes('加風扇'), 'hint groups', r);
    assert(r.chips.join() === '2,1' && r.afterChip === 1 && r.afterPage === 2, 'chip / page add', r);
    assert(r.groupRows.length === 2 && r.groupRows[1].includes('數據頁 2'), 'compliance grouped', r);
    assert(r.hintGone && /顯示未列入/.test(r.reopen || '') && r.hintBack, 'close / reopen', r);
    assert(r.align[0] === 'left' && r.align[1] === 'center', 'header alignment', r);
  });

  await T('結論頁 PDF continues onto more pages instead of clipping', async (page) => {
    const r = await page.evaluate(async () => {
      const comps = Array.from({ length: 45 }, (_, i) => comp('C' + i, { ta_55: String(100 + (i % 20)) }));
      const concl = { type: 'conclusion', order: 1, data: { summary: 'x', issues: ['i'], actions: [], compliance: comps.map(c => ({ component: c.name })) } };
      await useDb({ thermal_reports: { A: report('A', { 0: dataPage(0, comps), 1: concl }) } });
      await openReport('A');
      const pages = buildConclusionPagesHTML(state.pages[1].data);
      const joined = pages.join('');
      return { n: pages.length, allRows: comps.every(c => joined.includes('>' + c.name + '<')), issues: joined.includes('• i') };
    });
    assert(r.n >= 2 && r.allRows && r.issues, 'conclusion pagination', r);
  });

  await T('元件選取視窗顯示 Fail / Warning 並可一鍵勾選', async (page) => {
    const r = await page.evaluate(async () => {
      const sim = { type: 'sim_vs_meas', order: 1, data: { items: [] } };
      await useDb({ thermal_reports: { A: report('A', { 0: dataPage(0, [comp('F', { ta_55: '120' }), comp('W', { ta_55: '108' }), comp('P', { ta_55: '60' }), comp('N', {}), comp('D', { ta_55: '60' }, 125, '0.90', { disabled: true })]), 1: sim }) } });
      await openReport('A');
      selectPage(1);
      document.getElementById('sim-select-comp').click();
      const badges = Array.from(document.querySelectorAll('.csm-comp-cb')).map(cb => cb.closest('label').querySelector('.csm-badge').textContent.trim());
      const groupCount = document.querySelector('.anno-imp-page-row .anno-imp-count').textContent;
      document.getElementById('sim-modal-select-flagged').click();
      const checked = Array.from(document.querySelectorAll('.csm-comp-cb')).map(cb => cb.checked);
      document.getElementById('sim-modal-cancel').click();
      return { badges, groupCount, checked };
    });
    assert(r.badges[0].startsWith('❌ Fail') && r.badges[1].startsWith('⚠️ Warning') && r.badges[2].startsWith('✔ Pass') && r.badges[3] === '未量測' && r.badges[4] === '斷線 N/A', 'badges', r);
    assert(r.groupCount.includes('1 Fail') && r.groupCount.includes('1 Warning') && r.checked.join() === 'true,true,false,false,false', 'quick select', r);
  });

  console.log('SharePoint dual save');

  await SP('enable: every local report + TIM library is uploaded; chip shows synced', async (page, g) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }), B: report('B', { 0: cover('B') }) }, tim_library: { grease: [], pad: [{ name: 'PadA' }], putty: [] } });
      const res = await spSync.enable();
      const st = fileDb.sync.state();
      return { res, chip: document.querySelector('[data-sp-chip]').textContent, etags: Object.keys(st.etags).sort(), dirty: Object.keys(st.dirty), onDiskEtags: Object.keys(disk().sp_sync.etags).length,
               redirect: window.__msalConfig.auth.redirectUri === location.origin + '/auth.html' };
    });
    assert(r.res.ok && r.chip.includes('✓'), 'enabled + synced', r);
    assert(r.redirect, 'off GitHub Pages: auth.html next to the tool', r);
    assert(g.reportIds().sort().join() === 'A,B' && g.report('A').project_name === 'A', 'reports uploaded', g.reportIds());
    assert(g.json('Thermal_Report_Builder/Database/tim_library.json').tim_library.pad[0].name === 'PadA', 'TIM uploaded');
    assert(r.etags.join() === 'A,B' && r.dirty.length === 0 && r.onDiskEtags === 2, 'sync state persisted locally', r);
    assert(g.files.has('Thermal_Report_Builder/Backup/thermal_reports_backup_' + (await page.evaluate(() => localDateStr())) + '.json'), 'daily SharePoint backup');
  });

  await SP('dual save: editing one report uploads only that report', async (page, g) => {
    await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }), B: report('B', { 0: cover('B') }) } });
      await spSync.enable();
      await openReport('A');                      // legacy pages get ids → one structure upload
      await flushAllSaves(); await spSync.syncNow();
    });
    const before = { a: g.puts('reports/A.json'), b: g.puts('reports/B.json') };
    const r = await page.evaluate(async () => {
      const inp = document.querySelector('[data-field="dept"]');
      inp.value = 'NEW-DEPT'; inp.dispatchEvent(new Event('input'));
      await flushAllSaves();
      await spSync.syncNow();
      return { localDept: disk().thermal_reports.A.pages['0'].data.dept };
    });
    assert(r.localDept === 'NEW-DEPT' && g.report('A').pages['0'].data.dept === 'NEW-DEPT', 'saved in both places', r);
    assert(g.puts('reports/A.json') === before.a + 1 && g.puts('reports/B.json') === before.b, 'only A re-uploaded', { before, a: g.puts('reports/A.json'), b: g.puts('reports/B.json') });
  });

  await SP('pull: a colleague\'s new / changed / deleted reports reach the local file', async (page, g) => {
    await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }), B: report('B', { 0: cover('B') }) } });
      await spSync.enable();
    });
    const changedA = g.report('A'); changedA.project_name = 'A by colleague';
    g.putReport('A', changedA);
    g.putReport('C', { project_name: 'C new', created_at: '2026-10-01T00:00:00Z', pages: { 0: { id: 'pgC', type: 'cover', order: 0, data: { project_name: 'C new' } } } });
    g.files.delete('Thermal_Report_Builder/Database/reports/B.json');
    const r = await page.evaluate(async () => {
      await spSync.syncNow();
      const names = Array.from(document.querySelectorAll('.hp-card-title')).map(e => e.textContent.trim()).sort();
      return { ids: Object.keys(disk().thermal_reports).sort(), a: disk().thermal_reports.A.project_name, names };
    });
    assert(r.ids.join() === 'A,C' && r.a === 'A by colleague', 'pulled', r);
    assert(r.names.join() === 'A by colleague,C new', 'homepage refreshed', r.names);
  });

  await SP('conflict: both edited the same report → yours in place, theirs kept as a copy', async (page, g) => {
    await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }) } });
      await spSync.enable();
      await openReport('A');
    });
    const theirs = g.report('A'); theirs.pages['0'].data.dept = 'THEIR-DEPT';
    g.putReport('A', theirs, 'Colleague B');
    const r = await page.evaluate(async () => {
      const inp = document.querySelector('[data-field="dept"]');
      inp.value = 'MY-DEPT'; inp.dispatchEvent(new Event('input'));
      await flushAllSaves();
      await spSync.syncNow();
      await spSync.syncNow();                     // pushes the conflict copy
      const reps = disk().thermal_reports;
      const copyId = Object.keys(reps).find(id => id !== 'A');
      return { mine: reps.A.pages['0'].data.dept, copyName: copyId && reps[copyId].project_name, copyDept: copyId && reps[copyId].pages['0'].data.dept, copyId,
               toast: Array.from(document.querySelectorAll('.toast')).map(t => t.textContent).join(' | ') };
    });
    assert(r.mine === 'MY-DEPT' && g.report('A').pages['0'].data.dept === 'MY-DEPT', 'ours in place', r);
    assert(/衝突副本 · Colleague B/.test(r.copyName) && r.copyDept === 'THEIR-DEPT' && g.report(r.copyId) && g.report(r.copyId).pages['0'].data.dept === 'THEIR-DEPT', 'theirs kept as copy (local + SharePoint)', r);
    assert(/衝突副本/.test(r.toast), 'user told', r.toast);
  });

  await SP('offline: changes wait in the local file and are pushed later', async (page, g) => {
    await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }) } });
      await spSync.enable();
      await openReport('A');
    });
    g.down = true;
    const r1 = await page.evaluate(async () => {
      const inp = document.querySelector('[data-field="dept"]');
      inp.value = 'OFFLINE-EDIT'; inp.dispatchEvent(new Event('input'));
      await flushAllSaves();
      await spSync.syncNow();
      return { state: spSync.status().state, chip: document.querySelector('[data-sp-chip]').textContent, dirtyOnDisk: Object.keys(disk().sp_sync.dirty) };
    });
    assert(r1.state === 'pending' && /未同步/.test(r1.chip) && r1.dirtyOnDisk.includes('A'), 'pending recorded', r1);
    assert(g.report('A').pages['0'].data.dept !== 'OFFLINE-EDIT', 'not on SharePoint yet');
    g.down = false;
    const r2 = await page.evaluate(async () => { await spSync.syncNow(); return { state: spSync.status().state, dirty: Object.keys(disk().sp_sync.dirty) }; });
    assert(r2.state === 'synced' && r2.dirty.length === 0 && g.report('A').pages['0'].data.dept === 'OFFLINE-EDIT', 'pushed after reconnect', r2);
  });

  await SP('delete: local delete removes it on SharePoint; a remotely edited one is restored', async (page, g) => {
    await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }), B: report('B', { 0: cover('B') }) } });
      await spSync.enable();
    });
    const changedB = g.report('B'); changedB.project_name = 'B edited remotely';
    g.putReport('B', changedB);
    const r = await page.evaluate(async () => {
      await dbAdapter.deleteReport('A');
      await dbAdapter.deleteReport('B');
      await spSync.syncNow();
      return { ids: Object.keys(disk().thermal_reports) };
    });
    assert(!g.report('A') && g.report('B') && r.ids.join() === 'B', 'A deleted, B restored', { remote: g.reportIds(), r });
  });

  await SP('open report is not swapped while editing; applied after leaving', async (page, g) => {
    await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }) } });
      await spSync.enable();
      await openReport('A');
      await flushAllSaves(); await spSync.syncNow();
    });
    const theirs = g.report('A'); theirs.pages['0'].data.dept = 'REMOTE';
    g.putReport('A', theirs);
    const r = await page.evaluate(async () => {
      await spSync.syncNow();
      const during = disk().thermal_reports.A.pages['0'].data.dept;
      await leaveEditor();
      await spSync.__idle(); await sleep(50); await spSync.__idle();
      return { during, after: disk().thermal_reports.A.pages['0'].data.dept };
    });
    assert(r.during === 'DEPT-A' && r.after === 'REMOTE', 'deferred', r);
  });

  await SP('expired sign-in → "請重新登入", relogin syncs', async (page, g) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }) } });
      await spSync.enable();
      window.__expired = true;
      await dbAdapter.updateReportMeta('A', { project_name: 'A2' });
      await spSync.syncNow();
      const chip = document.querySelector('[data-sp-chip]').textContent;
      await spSync.relogin();
      return { chip, state: spSync.status().state };
    });
    assert(/重新登入/.test(r.chip) && r.state === 'synced' && g.report('A').project_name === 'A2', 'relogin', r);
  });

  await SP('TIM library: entries added on both sides are merged', async (page, g) => {
    await page.evaluate(async () => {
      await useDb({ thermal_reports: {}, tim_library: { grease: [], pad: [{ name: 'PadA' }], putty: [] } });
      await spSync.enable();
    });
    g.put('Thermal_Report_Builder/Database/tim_library.json', Buffer.from(JSON.stringify({ format: 'thermal-tim-library-v1', tim_library: { grease: [], pad: [{ name: 'PadA' }, { name: 'PadRemote' }], putty: [] } })), 'Colleague B');
    const r = await page.evaluate(async () => {
      await dbAdapter.setTimLibrary({ grease: [{ name: 'GreaseLocal' }], pad: [{ name: 'PadA' }], putty: [] });
      await spSync.syncNow();
      return disk().tim_library;
    });
    const remote = g.json('Thermal_Report_Builder/Database/tim_library.json').tim_library;
    assert(r.grease[0].name === 'GreaseLocal' && r.pad.map(x => x.name).join() === 'PadA,PadRemote', 'local merged', r);
    assert(remote.grease[0].name === 'GreaseLocal' && remote.pad.length === 2, 'remote merged', remote);
  });

  await SP('new empty local DB downloads everything from SharePoint', async (page, g) => {
    g.putReport('X', { project_name: 'X shared', created_at: '2026-10-01T00:00:00Z', pages: { 0: { id: 'pgX', type: 'cover', order: 0, data: { project_name: 'X shared' } } } });
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: {} });
      await spSync.enable();
      return Object.keys(disk().thermal_reports);
    });
    assert(r.join() === 'X', 'downloaded', r);
  });

  console.log('Efficiency tools');

  // Logger CSV: Keysight-style header (channel tags in <>), 30 s scans, ambient channel.
  const loggerCsvText = (tags, fn, n = 60) => {
    const rows = ['Scan,Time,' + tags.map((t, i) => `${101 + i} <${t}> (C)`).join(',')];
    for (let i = 0; i < n; i++) {
      const t = 13 * 3600 + i * 30;
      const hh = Math.floor(t / 3600), mm = String(Math.floor(t / 60) % 60).padStart(2, '0'), ss = String(t % 60).padStart(2, '0');
      rows.push(`${i + 1},2026/10/06 ${hh}:${mm}:${ss},` + tags.map((tag, k) => fn(tag, k, i).toFixed(2)).join(','));
    }
    return rows.join('\n');
  };

  await T('記錄器 CSV：依通道名稱對應、環溫選 Ta、取最後 10 分鐘平均、穩態檢查', async (page) => {
    const csv = loggerCsvText(['FPGA', 'PA-1', 'PA-10', 'Ambient'], (tag, k, i) =>
      tag === 'Ambient' ? 54.6 + (i % 2 ? 0.1 : -0.1)
      : tag === 'PA-10' ? 60 + i * 0.2                       // still rising → not stable
      : (tag === 'FPGA' ? 90 : 80) + (i % 2 ? 0.2 : -0.2));
    const r = await page.evaluate(async (csv) => {
      await useDb({ thermal_reports: { A: report('A', { 0: dataPage(0, [comp('PA-1', {}), comp('PA-10', { ta_55: '1' }), comp('FPGA', {})]) }) } });
      await openReport('A');
      showLoggerImportModal(state.pages[0], new File([csv], 'run55.csv', { type: 'text/csv' }));
      await sleep(300);
      const maps = Array.from(document.querySelectorAll('[data-lg-map]')).map(s => s.selectedOptions[0].textContent);
      const ta = document.getElementById('lg-ta').value;
      const amb = document.getElementById('lg-amb').selectedOptions[0].textContent;
      const foot = document.getElementById('lg-foot').textContent;
      document.getElementById('lg-apply').click();
      await flushAllSaves();
      const d = disk().thermal_reports.A.pages['0'].data;
      return { maps, ta, amb, foot, readings: d.components.map(c => c.readings.ta_55), map: Object.values(d.logger_map), last: d.logger_last.ta_55,
               summary: document.getElementById('dt-summary').textContent };
    }, csv);
    assert(r.maps.join() === '102 <PA-1> (C),103 <PA-10> (C),101 <FPGA> (C)' && r.amb.includes('Ambient') && r.ta === 'ta_55', 'auto mapping + Ta from ambient', r);
    assert(r.readings[0] === '80' && r.readings[2] === '90' && parseFloat(r.readings[1]) > 67 && parseFloat(r.readings[1]) < 72, 'last-10-min averages', r.readings);
    assert(/1 顆未達穩態/.test(r.foot) && r.last.unstable.join() === 'PA-10' && r.last.ambient === 54.6 && r.last.file === 'run55.csv', 'stability + log', r);
    assert(r.map.length === 3 && /run55\.csv/.test(r.summary), 'mapping remembered, import shown on the page', r);
  });

  await T('記錄器 CSV：名稱對不到就依順序；空白數據頁可直接由通道建立元件（修正到目標 Ta）', async (page) => {
    const csv = ['Time;CH1;CH2;Ta'].concat(Array.from({ length: 40 }, (_, i) => `13:${String(i).padStart(2, '0')}:00;70,0;75,5;53,0`)).join('\n');
    const r = await page.evaluate(async (csv) => {
      await useDb({ thermal_reports: { A: report('A', { 0: dataPage(0, [comp('U1', {}), comp('U2', {})]), 1: dataPage(1, [], [55]) }) } });
      await openReport('A');
      showLoggerImportModal(state.pages[0], new File([csv], 'a.csv'));
      await sleep(300);
      const order = Array.from(document.querySelectorAll('[data-lg-map]')).map(s => s.selectedOptions[0].textContent);
      document.querySelector('.tool-modal-overlay').remove();
      selectPage(1);
      showLoggerImportModal(state.pages[1], new File([csv], 'b.csv'));
      await sleep(300);
      const addChecked = document.getElementById('lg-add').checked;
      document.getElementById('lg-correct').click();
      document.getElementById('lg-apply').click();
      await flushAllSaves();
      return { order, addChecked, comps: disk().thermal_reports.A.pages['1'].data.components.map(c => [c.name, c.readings.ta_55]) };
    }, csv);
    assert(r.order.join() === 'CH1,CH2', 'order mapping (ambient excluded)', r);
    assert(r.addChecked && JSON.stringify(r.comps) === JSON.stringify([['CH1', '72'], ['CH2', '77.5']]), 'components created, corrected by +2°C', r);
  });

  await T('loggerCsv.parse：分號 / 逗號小數、跨午夜、錯誤值', async (page) => {
    const r = await page.evaluate(() => {
      const semi = loggerCsv.parse('Zeit;A;B\n23:59:30;25,5;OVER\n00:00:00;25,7;30,1\n00:00:30;25,9;30,3');
      const a = loggerCsv.analyze(semi, { minutes: 10 });
      return { delim: semi.delimiter, mode: semi.timeMode, span: a.info.totalMinutes, avgA: a.stats[0].avg, nB: a.stats[1].n,
               score: [loggerCsv.nameScore('PA-1', '101 <PA-1> (C)'), loggerCsv.nameScore('PA-1', '102 <PA-10> (C)')] };
    });
    assert(r.delim === ';' && r.mode === 'time' && r.span === 1 && Math.abs(r.avgA - 25.7) < 1e-9 && r.nB === 2, 'parse', r);
    assert(r.score[0] > 0 && r.score[1] === 0, 'token-aware name match', r);
  });

  await T('規格記憶：輸入其他報告用過的元件名稱，自動帶入規格；摘要列一鍵帶入', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: {
        OLD: report('OLD', { 0: dataPage(0, [comp('ADMV1013', {}, 105, '0.85', { spec_type: 'Rec.', category: 'PWR', tim_type: 'PadA' })]) }),
        A: report('A', { 0: dataPage(0, [comp('X', {}, ''), comp('ADMV1013', {}, '')]) }) } });
      await openReport('A');
      const dl = Array.from(document.querySelectorAll('#dt-name-memory option')).map(o => o.value);
      const btn = document.querySelector('[data-sum-fill-spec]');
      const inp = document.querySelector('input[data-comp="0"][data-comp-field="name"]');
      inp.value = 'ADMV1013'; inp.dispatchEvent(new Event('input')); inp.dispatchEvent(new Event('change'));
      await sleep(50);
      const c0 = state.pages[0].data.components[0];
      const before1 = state.pages[0].data.components[1].tc_spec;
      document.querySelector('[data-sum-fill-spec]').click();
      const c1 = state.pages[0].data.components[1];
      return { dl, btn: btn && btn.textContent, c0: [c0.tc_spec, c0.spec_type, c0.derating, c0.category, c0.tim_type], before1, c1: [c1.tc_spec, c1.derating],
               derated: document.querySelector('#dt-tbody tr[data-row-idx="0"]').querySelectorAll('td')[6].textContent };
    });
    assert(r.dl.includes('ADMV1013') && /1 顆/.test(r.btn), 'datalist + bulk button', r);
    assert(r.c0.join() === '105,Rec.,0.85,PWR,PadA' && r.derated === '89.3', 'filled on name commit + row recomputed', r);
    assert(r.before1 === '' && r.c1.join() === '105,0.85', 'bulk fill', r);
  });

  await T('數據頁摘要列：Pass / Warning / Fail 數、最小 Margin，輸入即更新', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: dataPage(0, [comp('P', { ta_55: '60' }), comp('W', { ta_55: '108' }), comp('N', {})]) }) } });
      await openReport('A');
      const s1 = document.getElementById('dt-summary').textContent.replace(/\s+/g, ' ');
      const inp = document.querySelector('input[data-comp="0"][data-ta-key="ta_55"]');
      inp.value = '120'; inp.dispatchEvent(new Event('input'));
      const s2 = document.getElementById('dt-summary').textContent.replace(/\s+/g, ' ');
      return { s1, s2 };
    });
    assert(/共 3 顆/.test(r.s1) && /1 Pass/.test(r.s1) && /1 Warning/.test(r.s1) && /未量測 1/.test(r.s1) && /最小 Margin：W 4\.0%/.test(r.s1), 'summary', r.s1);
    assert(/1 Fail/.test(r.s2) && /最小 Margin：P -6\.7%/.test(r.s2), 'live update', r.s2);
  });

  await T('數據頁「複製為新測試條件」：同元件、清空量測值，並直接命名', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: dataPage(0, [comp('PA', { ta_55: '90' })], [25, 55], { list_note: 'RF 無補償', machine_power: { ta_55: { v: '48', i: '9' } }, frozen: true }) }) } });
      await openReport('A');
      showContextMenu({ clientX: 10, clientY: 10 }, 0);
      const shown = getComputedStyle(document.getElementById('context-dup-clear')).display !== 'none';
      document.getElementById('context-dup-clear').click();
      const editing = !!document.querySelector('.page-note-input');
      document.querySelector('.page-note-input').value = 'RF 有補償';
      document.querySelector('.page-note-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await flushAllSaves();
      const p = disk().thermal_reports.A.pages;
      return { shown, editing, n: Object.keys(p).length, src: p['0'].data.components[0].readings.ta_55, copy: p['1'].data,
               uidSame: p['0'].data.components[0].uid === p['1'].data.components[0].uid };
    });
    assert(r.shown && r.editing && r.n === 2 && r.src === '90', 'copied after source', r);
    assert(JSON.stringify(r.copy.components[0].readings) === '{}' && r.copy.list_note === 'RF 有補償' && !r.copy.frozen && JSON.stringify(r.copy.machine_power) === '{}' && r.copy.ta_conditions.join() === '25,55', 'values cleared, named', r.copy);
  });

  await T('比對頁「貼上模擬結果」：依名稱對應，數據頁有的元件自動加入', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', {
        0: dataPage(0, [comp('PA-1', { ta_55: '80' }), comp('PA-10', { ta_55: '70' }), comp('FPGA', { ta_55: '90' })]),
        1: { type: 'sim_vs_meas', order: 1, data: { compare_ta: 55, items: [] } } }) } });
      await openReport('A');
      const all = getDataPageComponents();
      state.pages[1].data.items = [all[1]].map(c => ({ category: c.category, component_name: c.component_name, sim_tc: '', source_page: c.source_page, source_uid: c.source_uid }));
      selectPage(1);
      document.getElementById('sim-paste-names').click();
      const ta = document.getElementById('sp-text');
      ta.value = 'Name\tTemp (C)\nPA-10\t72.5\nFPGA 95.1\nPA-1\t83\nNope\t1';
      ta.dispatchEvent(new Event('input'));
      const foot = document.getElementById('sp-foot').textContent;
      document.getElementById('sp-apply').click();
      await flushAllSaves();
      const items = disk().thermal_reports.A.pages['1'].data.items;
      return { foot, items: items.map(it => [it.component_name, it.sim_tc]), judge: tds('#sim-tbody .sim-judge') };
    });
    assert(/更新 1 顆、新增 2 顆/.test(r.foot) && /1 列找不到/.test(r.foot), 'preview', r.foot);
    assert(JSON.stringify(r.items) === JSON.stringify([['PA-10', '72.5'], ['FPGA', '95.1'], ['PA-1', '83']]), 'applied by name', r.items);
  });

  await T('結論頁：產生結論草稿、由 Fail / Warning 產生 Issues（不重複）', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', {
        0: dataPage(0, [comp('F1', { ta_25: '90', ta_55: '120' }), comp('W1', { ta_55: '105' }), comp('P1', { ta_55: '60' })], [25, 55], { list_note: 'Full load', machine_power: { ta_55: { v: '48', i: '10' } } }),
        1: { type: 'conclusion', order: 1, data: { summary: '', issues: [''], actions: [], compliance: [] } } }) } });
      await openReport('A');
      selectPage(1);
      document.getElementById('concl-draft-btn').click();
      const summary = state.pages[1].data.summary;
      document.getElementById('concl-issues-btn').click();
      document.getElementById('concl-issues-btn').click();
      await flushAllSaves();
      return { summary, issues: disk().thermal_reports.A.pages['1'].data.issues, editor: document.getElementById('concl-summary-editor').innerText };
    });
    assert(/【數據頁 1 · Full load】Ta = 25 \/ 55°C，量測 3 顆元件：1 Pass、1 Warning、1 Fail/.test(r.summary) && /最小 Margin 為 F1 -6\.7%/.test(r.summary) && /整機功耗 480\.0 W @ Ta 55°C/.test(r.summary), 'per-condition line', r.summary);
    assert(/綜合判定：❌ FAIL；F1 超過 Derated Spec.*；W1 Margin 低於 10%/.test(r.summary) && r.editor.includes('綜合判定'), 'overall line', r.summary);
    assert(r.issues.length === 2 && /^F1：Tc 120\.0°C @ Ta 55°C 超過 Derated Spec 112\.5°C/.test(r.issues[0]) && /^W1：Margin 6\.7%/.test(r.issues[1]), 'issues once', r.issues);
  });

  await T('批次圖片頁：依檔名自然排序、每頁 N 張、檔名當說明；多張拖放自動續頁', async (page) => {
    const r = await page.evaluate(async () => {
      const png = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')).blob();
      const f = n => new File([png], n, { type: 'image/png' });
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A'), 1: { type: 'conclusion', order: 1, data: {} } }) } });
      await openReport('A');
      selectPage(0);
      await insertImagePagesFromFiles([f('IR_10.png'), f('IR_2.png'), f('IR_1.png'), f('Top.jpg.png'), new File(['x'], 'note.txt', { type: 'text/plain' })], { perPage: 2, captions: true, title: 'IR', afterIdx: 0 });
      const types = state.pages.map(p => p.type);
      const caps = state.pages.filter(p => p.type === 'image').map(p => p.data.images.map(im => im.caption).join('+'));
      // drop 8 files on a fresh image page → fills 6, continues on a new page
      selectPage(1);
      const pg = state.pages[1];
      pg.data.images = [];
      await dropImagesOnImagePage(pg, [1, 2, 3, 4, 5, 6, 7, 8].map(i => f('S' + i + '.png')));
      await flushAllSaves();
      const after = disk().thermal_reports.A.pages;
      return { types, caps, title: state.pages[1].data.title, n1: after['1'].data.images.length, n2: after['2'].data.images.map(im => im.caption).join(), total: Object.keys(after).length };
    });
    assert(r.types.join() === 'cover,image,image,conclusion' && r.caps.join('|') === 'IR_1+IR_2|IR_10+Top.jpg' && r.title === 'IR', 'batch pages', r);
    assert(r.n1 === 6 && r.n2 === 'S7,S8' && r.total === 5, 'multi-drop overflow', r);
  });

  await T('標註頁批次命名：每行一個名稱依序套用', async (page) => {
    const r = await page.evaluate(async () => {
      const mk = (i) => ({ id: 'm' + i, x: 10 * i, y: 10, label: 'TC' + i, label_x: 10 * i, label_y: 20 });
      await useDb({ thermal_reports: { A: report('A', { 0: { type: 'annotation', order: 0, data: { tc_category: 'RF', photo_url_or_base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', markers: [mk(1), mk(2), mk(3)] } } }) } });
      await openReport('A');
      document.getElementById('anno-batch-name').click();
      document.getElementById('ab-text').value = 'PA-1\n\nFPGA\nextra';
      document.getElementById('ab-ok').click();
      await flushAllSaves();
      return { labels: disk().thermal_reports.A.pages['0'].data.markers.map(m => m.label), list: Array.from(document.querySelectorAll('[data-an-name]')).map(i => i.value) };
    });
    assert(r.labels.join() === 'PA-1,TC2,FPGA' && r.list.join() === 'PA-1,TC2,FPGA', 'renamed in order, blank keeps', r);
  });

  await T('匯出前報告檢查：列出漏填項目，點項目跳到該頁；頁面清單徽章', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', {
        0: cover('A'),
        1: dataPage(1, [comp('F1', { ta_55: '120' }), comp('', { ta_55: '50' }), comp('NS', { ta_55: '50' }, '')], [55]),
        2: { type: 'sim_vs_meas', order: 2, data: { compare_ta: 55, items: [] } },
        3: { type: 'conclusion', order: 3, data: { summary: '', issues: [''], actions: [], compliance: [] } } }) } });
      await openReport('A');
      const badges = Array.from(document.querySelectorAll('.page-item')).map(el => (el.querySelector('.page-badge') || {}).textContent || '');
      const checks = runReportCheck().map(c => c.idx + ':' + c.text);
      document.getElementById('btn-export-pdf').click();
      const head = document.getElementById('exp-check-head').textContent.replace(/\s+/g, ' ');
      document.querySelector('.exp-check-item[data-goto="2"]').click();
      const active = state.activePage, modalGone = !document.getElementById('exp-check');
      // fixing the data → badge refreshes shortly after the edit
      selectPage(1);
      const inp = document.querySelector('input[data-comp="0"][data-ta-key="ta_55"]');
      inp.value = '60'; inp.dispatchEvent(new Event('input'));
      await sleep(600);
      const badgeAfter = document.querySelector('.page-item[data-index="1"] .page-badge').textContent;
      return { badges, checks, head, active, modalGone, badgeAfter };
    });
    assert(r.badges.join('|') === '|❌1|空|FAIL', 'badges', r.badges);
    const want = ['1:1 顆元件未命名', '1:1 顆元件未填 Tc Spec，無法判定', '2:比對頁尚未選取元件', '3:結論未填寫', '3:1 顆 Fail / Warning 元件未列入 Compliance Summary', '0:封面沒有產品圖片'];
    assert(want.every(w => r.checks.includes(w)), 'check items', r.checks);
    assert(/報告檢查：\d+ 項待確認/.test(r.head) && r.active === 2 && r.modalGone, 'picker + jump', r);
    assert(r.badgeAfter === '✓', 'badge refreshed', r.badgeAfter);
  });

  await T('新增報告：標準架構 / 以既有報告為範本（清空量測值、連結指向新頁）', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { SRC: { model: 'M', ...report('SRC', {
        0: { id: 'c0', ...cover('SRC'), data: { ...cover('SRC').data, cover_image: 'data:image/png;base64,AAA', tested_by: 'Tedus' } },
        1: { id: 'd1', ...dataPage(1, [comp('PA', { ta_55: '90' }, 125, '0.90', { uid: 'u1', highlight: 'y' })], [25, 55], { machine_power: { ta_55: { v: '1', i: '2' } }, logger_map: { u1: '101 <PA> (C)' }, list_note: 'Full' }) },
        2: { id: 's2', type: 'sim_vs_meas', order: 2, data: { compare_ta: 55, items: [{ component_name: 'PA', sim_tc: '88', source_page: 'd1', source_uid: 'u1' }], conclusion: 'old' } },
        3: { id: 'k3', type: 'conclusion', order: 3, data: { summary: 'old', issues: ['x'], actions: [{ description: 'a' }], compliance: [{ component: 'PA', source_page: 'd1', source_uid: 'u1' }] } },
        4: { id: 'n4', type: 'note', order: 4, data: { title: 'scratch', blocks: [] } } }) } } });
      await renderHomepage();
      document.querySelector('[data-action="template"]').click();
      document.getElementById('hp-new-name').value = 'NEW';
      const model = document.getElementById('hp-new-model').value;
      document.getElementById('hp-tpl-img').checked = false;
      document.getElementById('hp-new-stage').value = 'PVT';
      document.getElementById('hp-new-date').value = '2026-10-06';
      document.getElementById('hp-new-confirm').click();
      await sleep(200);
      await flushAllSaves();
      const id = Object.keys(disk().thermal_reports).find(k => k !== 'SRC');
      const p = disk().thermal_reports[id].pages;
      const simRef = resolveComponentRef(state.pages[2].data.items[0]);
      await leaveEditor();
      await createNewReport('STD', 'M', 'EVT', '2026-10-06', { mode: 'standard' });
      await flushAllSaves();
      const std = Object.values(disk().thermal_reports).find(x => x.project_name === 'STD');
      return { model, types: Object.values(p).map(x => x.type), cover: p['0'].data, data: p['1'].data, sim: p['2'].data, concl: p['3'].data,
               simRefOk: !!simRef && simRef.component_name === 'PA', newIds: Object.values(p).every(x => !['c0', 'd1', 's2', 'k3'].includes(x.id)),
               stdTypes: Object.values(std.pages).sort((a, b) => a.order - b.order).map(x => x.type) };
    });
    assert(r.model === 'M' && r.types.join() === 'cover,data,sim_vs_meas,conclusion' && r.newIds, 'structure (note dropped, new ids)', r);
    assert(r.cover.project_name === 'NEW' && r.cover.stage === 'PVT' && r.cover.cover_image === '' && r.cover.tested_by === 'Tedus', 'cover', r.cover);
    const c = r.data.components[0];
    assert(JSON.stringify(c.readings) === '{}' && c.tc_spec === '125' && !c.highlight && JSON.stringify(r.data.machine_power) === '{}' && r.data.logger_map.u1 && r.data.header.stage === 'PVT' && r.data.header.test_date === '2026-10-06', 'data cleared, specs kept', r.data);
    assert(r.sim.items[0].sim_tc === '' && r.sim.conclusion === '' && r.simRefOk, 'sim cleared + relinked', r.sim);
    assert(r.concl.summary === '' && r.concl.compliance.length === 0 && r.concl.actions.length === 0, 'conclusion cleared', r.concl);
    assert(r.stdTypes.join() === 'cover,image,annotation,data,sim_vs_meas,conclusion', 'standard set', r.stdTypes);
  });

  await T('首頁：搜尋、Stage 篩選、結果徽章；點卡片開啟', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: {
        A: { ...report('RRU-B41', { 0: dataPage(0, [comp('X', { ta_55: '120' })]) }), model: 'RRU4419', stage: 'DVT' },
        B: { ...report('AAU-n78', { 0: dataPage(0, [comp('X', { ta_55: '50' })]) }), model: 'AAU64', stage: 'EVT' },
        C: { ...report('RRU-n41', {}), model: 'RRU8820', stage: 'EVT' } } });
      await renderHomepage();
      const titles = () => Array.from(document.querySelectorAll('.hp-card-title')).map(e => e.textContent.trim()).sort().join();
      const results = Array.from(document.querySelectorAll('.hp-card')).map(c => c.querySelector('.hp-card-title').textContent.trim() + ':' + ((c.querySelector('.hp-result') || {}).textContent || '')).sort();
      const s = document.getElementById('hp-search');
      s.value = 'rru'; s.dispatchEvent(new Event('input'));
      const q = titles();
      document.querySelector('.hp-stage-btn[data-stage="EVT"]').click();
      const both = titles(), count = document.getElementById('hp-count').textContent;
      document.querySelector('.hp-card').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(100);
      return { results, q, both, count, opened: state.reportId };
    });
    assert(r.results.join() === 'AAU-n78:✓ PASS,RRU-B41:✕ FAIL,RRU-n41:', 'result badges', r.results);
    assert(r.q === 'RRU-B41,RRU-n41' && r.both === 'RRU-n41' && r.count === '顯示 1 / 3 份' && r.opened === 'C', 'filter + open', r);
  });

  await T('Ctrl+S 立即存檔；封面的部門 / Tested by 會成為下一份報告的預設', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }) } });
      await openReport('A');
      const dept = document.querySelector('[data-field="dept"]');
      dept.value = 'Thermal Team'; dept.dispatchEvent(new Event('input'));
      const tb = document.querySelector('[data-field="tested_by"]');
      tb.value = 'Tedus'; tb.dispatchEvent(new Event('input'));
      const pendingBefore = hasPendingSaves();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
      await sleep(100);
      const saved = disk().thermal_reports.A.pages['0'].data.dept;
      const toast = Array.from(document.querySelectorAll('.toast')).map(t => t.textContent).join('|');
      addCoverPage();
      return { pendingBefore, saved, toast, next: [state.pages[1].data.dept, state.pages[1].data.tested_by] };
    });
    assert(r.pendingBefore && r.saved === 'Thermal Team' && /已儲存/.test(r.toast), 'Ctrl+S', r);
    assert(r.next.join() === 'Thermal Team,Tedus', 'defaults remembered', r.next);
  });

  await SP('匯出 PDF 可同時上傳到 SharePoint Reports/<案名>_<Stage>/', async (page, g) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }) } });
      await spSync.enable();
      await openReport('A');
      document.getElementById('btn-export-pdf').click();
      const cb = document.getElementById('exp-sp-upload');
      const shown = !!cb && cb.checked;
      document.querySelector('.sim-modal-overlay').remove();
      const Orig = jspdf.jsPDF;
      window.jspdf = { jsPDF: function (...a) { const inst = new Orig(...a); inst.save = () => {}; return inst; } };
      await exportPDF(new Set([0]), { upload: true, folder: 'A_DVT' });
      return { shown, toast: Array.from(document.querySelectorAll('.toast')).map(t => t.textContent).join('|') };
    });
    const key = Array.from(g.files.keys()).find(k => k.startsWith('Thermal_Report_Builder/Reports/A_DVT/'));
    assert(r.shown && key && key.endsWith('_ThermalReport.pdf') && g.files.get(key).content.length > 1000, 'uploaded', { r, key });
    assert(/已上傳到 SharePoint/.test(r.toast), 'toast', r.toast);
  });

  await T('loggerCsv：單位列、經過時間欄、mm:ss、截斷的最後一行、括號名稱不混淆', async (page) => {
    const r = await page.evaluate(() => {
      const rows = n => Array.from({ length: n }, (_, i) => i);
      const units = loggerCsv.parse('No.,Time,CH1,CH2\n,,degC,degC\n' + rows(30).map(i => `${i + 1},13:${String(i).padStart(2, '0')}:00,50,60`).join('\n'));
      const elapsed = loggerCsv.parse('Date,Elapsed(s),A\n' + rows(30).map(i => `2026/10/06,${i * 30},50`).join('\n'));
      const mmss = loggerCsv.analyze(loggerCsv.parse('Time,A\n' + rows(41).map(i => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}.0,50`).join('\n')), { minutes: 10 });
      const cut = loggerCsv.parse('Time,A,B\n' + rows(30).map(i => `13:${String(i).padStart(2, '0')}:00,50,60`).join('\n') + '\n13:30:00,5');
      return { units: units.channels.map(c => c.name + '/' + c.unit).join(), unitsTime: units.timeHeader,
               elapsed: [elapsed.timeHeader, elapsed.timeMode, elapsed.channels.map(c => c.name).join()],
               mmss: [mmss.info.totalMinutes, mmss.info.rows], cut: [cut.rows.length, cut.channels.length],
               ddr: [loggerCsv.nameScore('DDR (U5)', '101 <DDR (U7)> (C)'), loggerCsv.nameScore('DDR (U5)', '102 <DDR (U5)> (C)')],
               label: loggerCsv.channelLabel('CH3: DDR (U5) [°C]') };
    });
    assert(r.units === 'CH1/degC,CH2/degC' && r.unitsTime === 'Time', 'units row skipped', r);
    assert(r.elapsed.join('|') === 'Elapsed(s)|time|A', 'elapsed column', r.elapsed);
    assert(r.mmss.join() === '20,21' && r.cut.join() === '30,2', 'mm:ss + truncated line', r);
    assert(r.ddr.join() === '0,2' && r.label === 'DDR (U5)', 'bracketed names', r);
  });

  await T('記錄器 CSV：只差括號編號的元件不會對調；凍結頁摘要仍可跳列；批次命名預填空白', async (page) => {
    const csv = loggerCsvText(['DDR (U7)', 'DDR (U5)'], (tag) => tag.includes('U7') ? 77 : 55);
    const r = await page.evaluate(async (csv) => {
      await useDb({ thermal_reports: { A: report('A', {
        0: dataPage(0, [comp('DDR (U5)', {}), comp('DDR (U7)', {})]),
        1: dataPage(1, [comp('F', { ta_55: '120' })], [55], { frozen: true }),
        2: { type: 'annotation', order: 2, data: { tc_category: 'RF', photo_url_or_base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', markers: [{ id: 'm1', x: 10, y: 10, label: 'Named' }, { id: 'm2', x: 20, y: 10 }] } } }) } });
      await openReport('A');
      showLoggerImportModal(state.pages[0], new File([csv], 'ddr.csv'));
      await sleep(300);
      document.getElementById('lg-apply').click();
      const vals = state.pages[0].data.components.map(c => c.name + '=' + c.readings.ta_25);   // no ambient → first empty Ta
      selectPage(1);
      const chip = document.querySelector('[data-sum-jump="fail"]');
      selectPage(2);
      document.getElementById('anno-batch-name').click();
      const prefill = document.getElementById('ab-text').value;
      document.getElementById('ab-ok').click();
      return { vals, chipEnabled: !!chip && !chip.disabled, prefill, labels: state.pages[2].data.markers.map(m => m.label || '') };
    }, csv);
    assert(r.vals.join() === 'DDR (U5)=55,DDR (U7)=77', 'no swap', r.vals);
    assert(r.chipEnabled, 'summary jump works on a frozen page', r);
    assert(r.prefill === 'Named\n' && r.labels.join() === 'Named,', 'unnamed markers stay automatic', r);
  });

  await T('Ctrl+S：存檔失敗時不顯示「已儲存」', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }) } });
      await openReport('A');
      await flushAllSaves();
      fileDb.__setDbCacheForTest({ thermal_reports: {} });      // the report vanished from the database
      const dept = document.querySelector('[data-field="dept"]');
      dept.value = 'X'; dept.dispatchEvent(new Event('input'));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
      await sleep(200);
      return Array.from(document.querySelectorAll('.toast')).map(t => t.textContent).join('|');
    });
    assert(/存檔失敗/.test(r) && !/已儲存/.test(r), 'failure reported', r);
  });

  console.log('Per-page review (round 2)');

  const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  await T('PDF：頁碼（封面除外）、檔名含版本、數據頁標題印測試條件、功耗表不再造成最後一列壓到頁尾', async (page) => {
    const r = await page.evaluate(async () => {
      const comps = Array.from({ length: 12 }, (_, i) => comp('C' + i, { ta_25: '50', ta_55: '80' }));
      await useDb({ thermal_reports: { A: report('A', {
        0: { ...cover('A'), data: { ...cover('A').data, report_version: 'v1.2' } },
        1: dataPage(1, comps, [25, 55], { list_note: 'Full load 8x40W', machine_power: { ta_25: { v: '48', i: '9' }, ta_55: { v: '48', i: '9.2' } } }) }) } });
      await openReport('A');
      openPreview();
      const vps = _virtualPages.map(vp => ({ type: vp.page.type, num: (vp.html.match(/>(\d+) \/ (\d+)</) || [])[0] || '' }));
      closePreview();
      // row bottoms vs the definition note on every data PDF page
      const overlaps = buildVirtualPages().filter(v => v.page.type === 'data').map(vp => {
        const d = document.createElement('div');
        d.style.cssText = 'position:fixed;left:0;top:0;width:842px;height:595px;background:#fff;font-family:' + PDF_FONT;
        d.innerHTML = vp.html; document.body.appendChild(d);
        const top = d.getBoundingClientRect().top;
        const rows = Array.from(d.querySelectorAll('tbody tr')); const last = rows[rows.length - 1];
        const note = Array.from(d.querySelectorAll('div')).find(x => x.children.length === 0 && x.textContent.trim().startsWith('※'));
        const res = { last: last.getBoundingClientRect().bottom - top, note: note ? note.getBoundingClientRect().top - top : 999 };
        d.remove();
        return res;
      });
      const title = buildVirtualPages()[1].html.includes('Full load 8x40W');
      let name = '';
      const Orig = jspdf.jsPDF;
      window.jspdf = { jsPDF: function (...a) { const inst = new Orig(...a); inst.save = (n) => { name = n; }; return inst; } };
      await exportPDF(new Set([0]));
      return { vps, overlaps, title, name };
    });
    assert(r.vps[0].num === '' && r.vps.slice(1).every((v, i) => v.num === `>${i + 2} / ${r.vps.length}<`), 'page numbers', r.vps);
    assert(r.overlaps.every(o => o.last <= o.note - 2), 'no row under the footnote', r.overlaps);
    assert(r.title && /_v1\.2_ThermalReport\.pdf$/.test(r.name), 'title + filename', r);
  });

  await T('封面：Stage 同步到數據頁；審核 / 核准有填才印', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A'), 1: dataPage(1, [comp('X', {})]), 2: dataPage(2, [comp('Y', {})]) }) } });
      await openReport('A');
      const st = document.querySelector('[data-field="stage"]');
      st.value = 'PVT'; st.dispatchEvent(new Event('change'));
      const before = buildCoverHTML(state.pages[0].data).includes('APPROVED BY');
      const ap = document.querySelector('[data-field="approved_by"]');
      ap.value = 'Director B'; ap.dispatchEvent(new Event('input'));
      await flushAllSaves();
      const p = disk().thermal_reports.A.pages;
      const html = buildCoverHTML(state.pages[0].data);
      return { stages: [p['1'].data.header.stage, p['2'].data.header.stage], before, approved: html.includes('APPROVED BY') && html.includes('Director B'), reviewed: html.includes('REVIEWED BY') };
    });
    assert(r.stages.join() === 'PVT,PVT', 'stage synced', r);
    assert(!r.before && r.approved && !r.reviewed, 'sign-off rows printed only when filled', r);
  });

  await T('圖片頁：往前 / 往後移一格（說明跟著走）', async (page) => {
    const r = await page.evaluate(async (png) => {
      await useDb({ thermal_reports: { A: report('A', { 0: { type: 'image', order: 0, data: { title: 'T', images: [{ position: 0, url_or_base64: png, caption: 'first' }, { position: 1, url_or_base64: png, caption: 'second' }] } } }) } });
      await openReport('A');
      imSelect(state.pages[0], null, 0);
      const prevOnFirst = !document.querySelector('[data-im-tool="up"]').disabled;
      await imTool(state.pages[0], 'down');
      await flushAllSaves();
      return { prevOnFirst, caps: disk().thermal_reports.A.pages['0'].data.images.map(im => im.position + ':' + im.caption) };
    }, PNG1);
    assert(!r.prevOnFirst && r.caps.join() === '0:second,1:first', 'swapped', r);
  });

  await T('標註頁：量測溫度疊圖（依狀態上色，PDF 也有）、標籤寬度自動、批次命名帶入數據頁名稱', async (page) => {
    const r = await page.evaluate(async (png) => {
      const mk = (i, label) => ({ id: 'm' + i, x: 10 + i * 20, y: 20, label, label_x: 10 + i * 20, label_y: 70 });
      await useDb({ thermal_reports: { A: report('A', {
        0: { id: 'an', type: 'annotation', order: 0, data: { tc_category: 'RF', title: 'RF Thermocouple Location', photo_url_or_base64: png, markers: [mk(0, 'PA-1'), mk(1, 'Very long inductor name L101'), mk(2, 'Hot'), mk(3, 'Unknown')] } },
        1: { id: 'dp', ...dataPage(1, [comp('PA-1', { ta_55: '60' }), comp('Very long inductor name L101', { ta_55: '108' }), comp('Hot', { ta_55: '120' })], [25, 55], { list_note: 'Full' }) } }) } });
      await openReport('A');
      const sel = document.querySelector('[data-anno-temp-page]');
      sel.value = 'dp'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      const badges = Array.from(document.querySelectorAll('[data-an-row]')).map(li => (li.querySelector('.an-temp') || {}).className || '-');
      const widths = Array.from(document.querySelectorAll('[data-an-lbl]')).map(l => parseFloat(l.style.width));
      const pdf = buildAnnotationHTML(state.pages[0].data);
      document.getElementById('anno-batch-name').click();
      document.getElementById('ab-fill').click();
      const filled = document.getElementById('ab-text').value;
      document.querySelector('.tool-modal-overlay').remove();
      return { src: state.pages[0].data.temp_src, badges, widths, pdf120: />Hot<\/span><span[^>]*#b91c1c[^>]*>120\.0°C/.test(pdf), pdfSub: pdf.includes('實測 Tc（Ta = 55°C · 數據頁 1 · Full）'), filled };
    }, PNG1);
    assert(r.src.page_id === 'dp' && r.src.ta === 55, 'source saved', r.src);
    assert(r.badges.join('|') === 'an-temp pass|an-temp warn|an-temp fail|-', 'coloured badges', r.badges);
    assert(r.widths[1] > r.widths[0] + 80, 'auto label width', r.widths);
    assert(r.pdf120 && r.pdfSub, 'PDF overlay', r);
    assert(r.filled === 'PA-1\nVery long inductor name L101\nHot', 'batch-name fill from data page', r.filled);
  });

  await T('數據頁排序：依最差 Margin、依類別（可復原）', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: dataPage(0, [comp('A', { ta_55: '60' }, 125, '0.90', { category: 'PWR' }), comp('B', { ta_55: '110' }), comp('C', { ta_55: '90' }, 125, '0.90', { category: 'Digital' })]) }) } });
      await openReport('A');
      const sort = (mode) => { const sel = document.getElementById('dt-sort'); sel.value = mode; sel.dispatchEvent(new Event('change')); return state.pages[0].data.components.map(c => c.name).join(); };
      const byMargin = sort('margin');
      await flushAllSaves();
      const byCat = sort('cat');
      await flushAllSaves();
      const byName = sort('name');
      await flushAllSaves();
      performUndo();
      return { byMargin, byCat, byName, undone: state.pages[0].data.components.map(c => c.name).join() };
    });
    assert(r.byMargin === 'B,C,A' && r.byCat === 'B,C,A' && r.byName === 'A,B,C', 'sorted', r);
    assert(r.undone === 'B,C,A', 'undo restores the previous order', r);
  });

  await T('比對頁：比較圖（編輯器 + PDF，可關閉）、產生比對結論', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', {
        0: { id: 'dp', ...dataPage(0, [comp('PA', { ta_55: '80' }, 125, '0.90', { uid: 'u1' }), comp('FPGA', { ta_55: '90' }, 125, '0.90', { uid: 'u2' })]) },
        1: { type: 'sim_vs_meas', order: 1, data: { compare_ta: 55, items: [{ component_name: 'PA', sim_tc: '84', source_page: 'dp', source_uid: 'u1' }, { component_name: 'FPGA', sim_tc: '99', source_page: 'dp', source_uid: 'u2' }] } } }) } });
      await openReport('A');
      selectPage(1);
      const img = document.getElementById('sim-chart-img');
      const shown = img.style.display !== 'none' && img.src.startsWith('data:image/png');
      const pdfOn = buildSimVsMeasPagesHTML(state.pages[1].data).join('').includes('data:image/png');
      document.getElementById('sim-concl-draft').click();
      const concl = state.pages[1].data.conclusion;
      document.getElementById('sim-chart-on').click();
      const pdfOff = buildSimVsMeasPagesHTML(state.pages[1].data).join('').includes('data:image/png');
      return { shown, pdfOn, pdfOff, hidden: document.getElementById('sim-chart-img').style.display === 'none', concl };
    });
    assert(r.shown && r.pdfOn && !r.pdfOff && r.hidden, 'chart on / off', r);
    assert(/比對 2 顆元件：✅ 0、⚠️ 1、❌ 1/.test(r.concl) && /模擬整體偏高 \+6\.5°C/.test(r.concl) && /最大偏差 FPGA \+9\.0°C/.test(r.concl), 'sim conclusion', r.concl);
  });

  await T('結論頁：由 Fail / Warning 產生行動（Owner = Tested by、期限兩週、不重複）', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', {
        0: { ...cover('A'), data: { ...cover('A').data, tested_by: 'Tedus' } },
        1: dataPage(1, [comp('F1', { ta_55: '120' }), comp('W1', { ta_55: '105' }), comp('P1', { ta_55: '60' })]),
        2: { type: 'conclusion', order: 2, data: { summary: '', issues: [''], actions: [{ description: '', owner: '', due_date: '' }], compliance: [] } } }) } });
      await openReport('A');
      selectPage(2);
      document.getElementById('concl-actions-btn').click();
      document.getElementById('concl-actions-btn').click();
      const due = new Date(Date.now() + 14 * 86400000);
      return { actions: state.pages[2].data.actions, due: `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}` };
    });
    assert(r.actions.length === 2 && /^改善 F1 散熱並重測/.test(r.actions[0].description) && /^追蹤 W1 溫度餘裕/.test(r.actions[1].description), 'actions', r.actions);
    assert(r.actions.every(a => a.owner === 'Tedus' && a.due_date === r.due), 'owner + due', r);
  });

  await T('備註頁：記錄的截圖一鍵做成圖片頁（插在結論頁前）；預覽雙擊回到該頁', async (page) => {
    const r = await page.evaluate(async (png) => {
      await useDb({ thermal_reports: { A: report('A', {
        0: cover('A'),
        1: { type: 'conclusion', order: 1, data: { summary: 'x', issues: [''], actions: [], compliance: [] } },
        2: { type: 'note', order: 2, data: { title: 'n', blocks: [{ id: 'b1', time: 't', text: 'IR @ 55C\nmore', images: [{ name: 'ir1.png', url: png }, { name: 'ir2.png', url: png }] }] } } }) } });
      await openReport('A');
      selectPage(2);
      document.querySelector('[data-note-to-image="0"]').click();
      await flushAllSaves();
      const pages = Object.values(disk().thermal_reports.A.pages).sort((a, b) => a.order - b.order);
      openPreview();
      previewIdx = 0; renderPreviewPage();
      document.querySelector('#preview-canvas-wrap > div').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return { types: pages.map(p => p.type), img: pages[1].data, previewOpen: document.getElementById('preview-overlay').classList.contains('open'), active: state.activePage };
    }, PNG1);
    assert(r.types.join() === 'cover,image,conclusion,note' && r.img.title === 'IR @ 55C' && r.img.images.map(i => i.caption).join() === 'ir1,ir2', 'image page from note', r);
    assert(!r.previewOpen && r.active === 0, 'preview dblclick → edit', r);
  });

  await T('目錄頁：插在封面後、頁碼依實際 PDF 頁數（只匯出部分頁面時重算）', async (page) => {
    const r = await page.evaluate(async (png) => {
      await useDb({ thermal_reports: { A: report('A', {
        0: cover('A'),
        1: { type: 'image', order: 1, data: { title: 'Test Setup', images: [{ position: 0, url_or_base64: png, caption: '' }] } },
        2: { id: 'dp', ...dataPage(2, [comp('PA', { ta_55: '80' })], [25, 55], { list_note: 'Full Load' }) },
        3: { type: 'note', order: 3, data: { title: 'n', blocks: [] } },
        4: { type: 'conclusion', order: 4, data: { summary: 'x', issues: [''], actions: [], compliance: [] } } }) } });
      await openReport('A');
      selectPage(4);
      document.querySelector('.dropdown-item[data-type="toc"]').click();
      await flushAllSaves();
      const types = Object.values(disk().thermal_reports.A.pages).sort((a, b) => a.order - b.order).map(p => p.type);
      const entries = (list) => {
        const vp = list.find(v => v.page.type === 'toc');
        const el = document.createElement('div');
        el.innerHTML = vp.html;
        return Array.from(el.querySelectorAll('div')).filter(d => d.children.length === 3 && d.style.display === 'flex')
          .map(d => d.children[0].textContent + '=' + d.children[2].textContent);
      };
      const all = numberVirtualPages(buildVirtualPages());
      const subset = numberVirtualPages(buildVirtualPages().filter(vp => [0, 1, 5].includes(vp.pageIdx)));
      const editorShowsNumbers = document.getElementById('editor-canvas').textContent.includes('Test Conclusion');
      const inp = document.getElementById('toc-title');
      inp.value = '目錄'; inp.dispatchEvent(new Event('change'));
      await flushAllSaves();
      return { active: state.activePage, types, all: entries(all), subset: entries(subset), tocFooter: all[1].html.includes('2 / 5'), editorShowsNumbers,
        title: Object.values(disk().thermal_reports.A.pages).find(p => p.type === 'toc').data.title,
        retitled: numberVirtualPages(buildVirtualPages())[1].html.includes('目錄') };
    }, PNG1);
    assert(r.types.join() === 'cover,toc,image,data,note,conclusion' && r.active === 1, 'inserted after the cover', r);
    assert(r.all.join('|') === 'Test Setup=3|Thermal Test Data — Full Load=4|Test Conclusion=5' && r.tocFooter, 'entries + numbers', r.all);
    assert(r.subset.join('|') === 'Test Conclusion=3', 'renumbered for a partial export', r.subset);
    assert(r.editorShowsNumbers && r.title === '目錄' && r.retitled, 'editor preview + title', r);
  });

  await T('比較頁：本報告不同測試條件（ΔTc、依 |ΔTc| 排序、摘要、結論草稿、範本重新對應）', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', {
        0: cover('A'),
        1: { id: 'd1', ...dataPage(1, [comp('PA', { ta_55: '90' }), comp('LNA', { ta_55: '70' }), comp('FPGA', { ta_55: '100' })], [25, 55], { list_note: '補償前' }) },
        2: { id: 'd2', ...dataPage(2, [comp('PA', { ta_55: '85' }), comp('LNA', { ta_55: '71.2' }), comp('FPGA', { ta_55: '100.3' }), comp('NEW', { ta_55: '50' })], [25, 55], { list_note: '補償後' }) },
        3: { type: 'conclusion', order: 3, data: { summary: '', issues: [''], actions: [], compliance: [] } } }) } });
      await openReport('A');
      selectPage(2);
      document.querySelector('.dropdown-item[data-type="compare"]').click();
      await flushAllSaves();
      const idx = state.pages.findIndex(p => p.type === 'compare');
      const d = state.pages[idx].data;
      const series = d.series.map(s => s.page_id).join();
      const t = compareTable(d, false);
      const deltas = t.rows.map(row => row.name + ':' + (isNaN(row.deltas[1]) ? '-' : row.deltas[1].toFixed(1)));
      const summary = Array.from(document.querySelectorAll('.cmp-summary div')).map(x => x.textContent);
      const sel = document.getElementById('cmp-sort');
      sel.value = 'delta'; sel.dispatchEvent(new Event('change'));
      await flushAllSaves();
      const sortedNames = compareTable(state.pages[idx].data, false).rows.map(row => row.name).join();
      const saved = Object.values(disk().thermal_reports.A.pages).find(p => p.type === 'compare').data;
      const pdf = buildComparePagesHTML(state.pages[idx].data);
      const tpl = templateFromPages(state.pages, { name: 'N', model: '', stage: 'PVT', date: '2026-02-02' });
      const tplData = tpl.filter(p => p.type === 'data').map(p => p.id).join();
      const tplSeries = tpl.find(p => p.type === 'compare').data.series.map(s => s.page_id).join();
      const draft = buildConclusionDraft();
      return { series, deltas, summary, sortedNames, savedSort: saved.sort, pdfPages: pdf.length, pdfSummary: pdf[0].includes('降溫最多 PA -5.0°C'), tplData, tplSeries,
        draft: /【比較】數據頁 2 · 補償後 對比 數據頁 1 · 補償前：平均 ΔTc -1\.2°C/.test(draft), label: pageBaseLabel(idx), badge: pageBadge(state.pages[idx]) };
    });
    assert(r.series === 'd1,d2' && r.label === '比較頁 1', 'defaults to this report\'s data pages', r);
    assert(r.deltas.join() === 'PA:-5.0,LNA:1.2,FPGA:0.3,NEW:-', 'ΔTc per component', r.deltas);
    assert(r.summary.length === 1 && r.summary[0] === '■ 數據頁 2 · 補償後 對比 數據頁 1 · 補償前：平均 ΔTc -1.2°C（3 顆），降溫最多 PA -5.0°C，升溫最多 LNA +1.2°C。', 'summary', r.summary);
    assert(r.sortedNames === 'PA,LNA,FPGA,NEW' && r.savedSort === 'delta', 'sorted by |ΔTc|', r);
    assert(r.pdfPages === 1 && r.pdfSummary && r.draft, 'PDF + conclusion draft', r);
    assert(r.tplSeries === r.tplData && r.tplSeries !== 'd1,d2', 'template re-points local series', r);
  });

  await T('比較頁：跨報告（EVT vs DVT）存快照，來源報告刪除後仍可顯示與匯出', async (page) => {
    const r = await page.evaluate(async () => {
      const evtCover = { ...cover('RRU-A'), data: { ...cover('RRU-A').data, stage: 'EVT' } };
      await useDb({ thermal_reports: {
        E: report('RRU-A', { 0: evtCover, 1: { id: 'ea', ...dataPage(1, [comp('PA', { ta_55: '95' }), comp('LNA', { ta_55: '72' })], [25, 55], { list_note: 'Full' }) } }),
        D: report('RRU-A', { 0: cover('RRU-A'), 1: { id: 'db', ...dataPage(1, [comp('PA', { ta_55: '88' }), comp('LNA', { ta_55: '73' })], [25, 55], { list_note: 'Full' }) },
          2: { id: 'cp', type: 'compare', order: 2, data: { title: 'EVT vs DVT', ta: null, sort: 'order', series: [] } } }) } });
      await openReport('D');
      selectPage(2);
      const add = (v) => { const s = document.getElementById('cmp-add'); s.value = v; s.dispatchEvent(new Event('change')); };
      const optText = Array.from(document.querySelectorAll('#cmp-add option')).map(o => o.textContent);
      add('R|E|ea');
      add('L|db');
      await flushAllSaves();
      const saved = disk().thermal_reports.D.pages['2'].data.series;
      const before = compareTable(state.pages[2].data, false).rows.map(row => row.name + ':' + row.deltas[1].toFixed(1)).join();
      const head = tds('.cmp-table th');
      await dbAdapter.deleteReport('E');
      await loadSpecMemory();
      selectPage(1); selectPage(2);
      const after = compareTable(state.pages[2].data, false).rows.map(row => row.name + ':' + row.deltas[1].toFixed(1)).join();
      const snapTag = document.querySelector('.cmp-warn') ? document.querySelector('.cmp-warn').textContent : '';
      const pdf = buildComparePagesHTML(state.pages[2].data).join('');
      const check = runReportCheck().filter(x => x.idx === 2).map(x => x.level + ':' + x.text);
      state.pages[2].data.series.push({ report_id: null, page_id: 'gone', label: '' });
      const check2 = runReportCheck().filter(x => x.idx === 2).map(x => x.text);
      return { optText, snap: saved[0].snapshot, src: saved.map(s => (s.report_id || 'local') + '/' + s.page_id).join(), before, head, after, snapTag,
        pdfSnapNote: pdf.includes('使用加入時的數值快照'), pdfLabel: pdf.includes('EVT · RRU-A · 數據頁 1 · Full'), check, check2 };
    });
    assert(r.optText.includes('EVT · RRU-A · 數據頁 1 · Full'), 'other report offered with stage + name', r.optText);
    assert(r.src === 'E/ea,local/db' && r.snap && r.snap.stage === 'EVT' && r.snap.components.length === 2 && r.snap.components[0].readings.ta_55 === '95', 'snapshot stored', r);
    assert(r.before === 'PA:-7.0,LNA:1.0' && r.head.some(h => h.startsWith('EVT · RRU-A · 數據頁 1 · Full')), 'cross-report ΔTc', r);
    assert(r.after === r.before && r.snapTag === '快照' && r.pdfSnapNote && r.pdfLabel, 'still works from the snapshot', r);
    assert(r.check.join('|') === 'info:部分比較對象使用快照（來源報告不在目前資料庫）', 'report check info', r.check);
    assert(r.check2.includes('1 個比較對象找不到來源'), 'missing source flagged', r.check2);
  });


  console.log('Annotation page (shared editor / PDF layout)');

  // In-page helpers for the annotation tests: a wide "board" photo and a page.
  const ANNO_SETUP = () => {
    window.photo = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#234'; x.fillRect(0, 0, w, h); x.fillStyle = '#eee'; x.fillRect(w / 4, h / 4, w / 2, h / 2); return c.toDataURL('image/png'); };
    window.annoRect = (sel) => document.querySelector(sel).getBoundingClientRect();
  };

  await T('標註頁：舊資料轉換（框位置、標籤 % → px、翻轉轉旋轉），編輯器與 PDF 版面相同', async (page) => {
    await page.evaluate(ANNO_SETUP);
    const r = await page.evaluate(async () => {
      const png = photo(400, 200);
      const markers = [{ id: 'a', x: 25, y: 50, label: 'PA', label_x: 2, label_y: 10 }, { id: 'b', x: 75, y: 50, label: 'LNA', label_x: 85, label_y: 50 }];
      await useDb({ thermal_reports: { A: report('A', { 0: { type: 'annotation', order: 0, data: { tc_category: 'RF', photo_url_or_base64: png, anno_photo_x: 200, anno_photo_y: 100, anno_photo_w: 400, anno_photo_h: 200, anno_flip_v: true, markers } } }) } });
      await openReport('A');
      await sleep(300);
      await flushAllSaves();
      const d = disk().thermal_reports.A.pages['0'].data;
      const pdf = new DOMParser().parseFromString(buildAnnotationHTML(state.pages[0].data), 'text/html');
      const geo = el => [el.style.left, el.style.top, el.style.width, el.style.height].join(',');
      const pdfLabels = Array.from(pdf.querySelectorAll('div[style*="border:1px solid #2357A7"]')).map(geo);
      const edLabels = Array.from(document.querySelectorAll('#an-ov [data-an-lbl]')).map(geo);
      const pdfDots = Array.from(pdf.querySelectorAll('div[style*="border-radius:50%"]')).map(geo);
      const edDots = Array.from(document.querySelectorAll('#an-ov [data-an-dot]')).map(geo);
      return { v: d.anno_v, box: d.img_box, rot: d.img_rot, fh: d.img_fh, old: 'anno_photo_x' in d || 'label_x' in d.markers[0], lx: d.markers.map(m => m.lx + ',' + m.ly), pdfLabels, edLabels, pdfDots, edDots, again: annoNormalize(state.pages[0].data) };
    });
    assert(r.v === 2 && !r.old && r.rot === 180 && r.fh === true, 'migrated', r);
    assert(r.box.x === 200 && r.box.y === 100 && r.box.w === 400 && r.box.h === 200, 'frame kept (already the photo aspect)', r.box);
    assert(r.lx[0] === '16.8,55.9' && r.lx[1] === '715.7,279.5', 'labels % → stage px', r.lx);
    assert(r.pdfLabels.length === 2 && r.pdfLabels.join('|') === r.edLabels.join('|') && r.pdfDots.join('|') === r.edDots.join('|'), 'editor = PDF geometry', r);
    assert(r.again === false, 'normalize is idempotent', r);
  });

  await T('標註頁：拖曳照片整組移動（Alt 只移照片）、拖角縮放，標註點留在照片同一位置', async (page) => {
    await page.evaluate(ANNO_SETUP);
    await page.evaluate(async () => {
      const markers = [{ id: 'a', x: 25, y: 50, label: 'PA', lx: 60, ly: 150 }, { id: 'b', x: 75, y: 25, label: 'LNA', lx: 680, ly: 100 }];
      await useDb({ thermal_reports: { A: report('A', { 0: { type: 'annotation', order: 0, data: { anno_v: 2, img_fit: true, tc_category: 'RF', photo_url_or_base64: photo(400, 200), img_box: { x: 200, y: 100, w: 400, h: 200 }, markers } } }) } });
      await openReport('A');
    });
    await page.waitForTimeout(200);
    const k = await page.evaluate(() => annoRect('#an-paper').width / 842);
    const img = await page.evaluate(() => { const r = annoRect('#an-img'); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(img.x, img.y); await page.mouse.down();
    await page.mouse.move(img.x + 40 * k, img.y + 20 * k, { steps: 5 }); await page.mouse.up();
    const a = await page.evaluate(() => { const d = state.pages[0].data; return { box: d.img_box, m: d.markers.map(m => [m.x, m.y, m.lx, m.ly].join(',')) }; });
    await page.keyboard.down('Alt');
    await page.mouse.move(img.x + 40 * k, img.y + 20 * k); await page.mouse.down();
    await page.mouse.move(img.x, img.y + 20 * k, { steps: 5 }); await page.mouse.up();
    await page.keyboard.up('Alt');
    const b = await page.evaluate(() => { const d = state.pages[0].data; return { box: d.img_box, m: d.markers.map(m => [m.x, m.y, m.lx, m.ly].join(',')) }; });
    const h = await page.evaluate(() => { const r = annoRect('[data-an-handle="se"]'); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(h.x, h.y); await page.mouse.down();
    await page.mouse.move(h.x + 100 * k, h.y, { steps: 5 }); await page.mouse.up();
    const c = await page.evaluate(async () => { await flushAllSaves(); const d = disk().thermal_reports.A.pages['0'].data; return { box: d.img_box, m: d.markers.map(m => [m.x, m.y].join(',')) }; });
    assert(Math.abs(a.box.x - 240) < 1.5 && Math.abs(a.box.y - 120) < 1.5, 'photo moved', a.box);
    assert(a.m[0].startsWith('25,50,') && Math.abs(parseFloat(a.m[0].split(',')[2]) - 100) < 1.5 && Math.abs(parseFloat(a.m[0].split(',')[3]) - 170) < 1.5, 'points + labels moved with it', a.m);
    assert(Math.abs(b.box.x - 200) < 1.5 && b.m[0] === a.m[0], 'Alt: labels stay', b);
    assert(Math.abs(c.box.w - 500) < 2 && Math.abs(c.box.h - 250) < 2 && c.m.join('|') === '25,50|75,25', 'resize keeps aspect and points', c);
  });

  await T('標註頁：旋轉 / 翻轉 / 裁切時標註點跟著照片', async (page) => {
    await page.evaluate(ANNO_SETUP);
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: { type: 'annotation', order: 0, data: { anno_v: 2, img_fit: true, tc_category: 'RF', photo_url_or_base64: photo(400, 200), img_box: { x: 200, y: 100, w: 400, h: 200 }, markers: [{ id: 'a', x: 10, y: 20, label: 'PA', lx: 30, ly: 30 }] } } }) } });
      await openReport('A');
      const d = state.pages[0].data;
      const pt = () => d.markers[0].x + ',' + d.markers[0].y;
      document.querySelector('[data-an-tool="rotr"]').click();
      const rot = { pt: pt(), r: d.img_rot, box: d.img_box.w + 'x' + d.img_box.h, css: buildAnnotationHTML(d).includes('rotate(90deg)') };
      document.querySelector('[data-an-tool="rotl"]').click();
      const back = pt() + '/' + d.img_rot;
      document.querySelector('[data-an-tool="fliph"]').click();
      const fh = pt() + '/' + d.img_rot + '/' + d.img_fh;
      document.querySelector('[data-an-tool="flipv"]').click();
      const fv = pt() + '/' + d.img_rot + '/' + d.img_fh;
      // crop: keep the middle half → the point stays on the same spot of the page
      annoApplyCrop(d, d.photo_url_or_base64, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
      return { rot, back, fh, fv, crop: pt(), box: d.img_box };
    });
    assert(r.rot.pt === '80,10' && r.rot.r === 90 && r.rot.box === '200x400' && r.rot.css, 'rotate right', r.rot);
    assert(r.back === '10,20/0', 'rotate back', r.back);
    assert(r.fh === '90,20/0/true' && r.fv === '90,80/180/false', 'flips', r);
    assert(r.crop === '80,60' && r.box.x === 400 && r.box.w === 200, 'crop keeps the point in place', r);
  });

  await T('標註頁：標註模式點照片新增（就地命名）、依序放置數據頁元件、Delete / 方向鍵', async (page) => {
    await page.evaluate(ANNO_SETUP);
    await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', {
        0: { type: 'annotation', order: 0, data: { anno_v: 2, img_fit: true, tc_category: 'RF', photo_url_or_base64: photo(400, 200), img_box: { x: 220, y: 120, w: 400, h: 200 }, markers: [] } },
        1: { id: 'dp', ...dataPage(1, [comp('PA-1', {}), comp('PA-2', {}), comp('LNA', {})]) } }) } });
      await openReport('A');
    });
    await page.waitForTimeout(150);
    const at = (fx, fy) => page.evaluate(([fx, fy]) => { const r = annoRect('#an-img'); return { x: r.left + r.width * fx, y: r.top + r.height * fy }; }, [fx, fy]);
    await page.keyboard.press('a');
    let p = await at(0.2, 0.3);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(100);
    const renaming = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('an-rename'));
    await page.keyboard.type('Heatsink');
    await page.keyboard.press('Enter');
    await page.click('#an-seq');
    for (const [fx, fy] of [[0.5, 0.3], [0.8, 0.3]]) { p = await at(fx, fy); await page.mouse.click(p.x, p.y); await page.waitForTimeout(80); }
    const placed = await page.evaluate(() => ({ names: state.pages[0].data.markers.map(m => m.label), x: state.pages[0].data.markers[0].x, armed: annoUI.armed, left: annoUnplaced(state.pages[0].data) }));
    await page.keyboard.press('Escape');
    // select the 2nd label, nudge it, delete the 1st via the side list
    const l = await page.evaluate(() => { const r = document.querySelectorAll('[data-an-lbl]')[1].getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height / 2 }; });
    await page.mouse.click(l.x, l.y);
    const before = await page.evaluate(() => state.pages[0].data.markers[1].lx);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const nudged = await page.evaluate(() => state.pages[0].data.markers[1].lx);
    await page.keyboard.press('Delete');
    const after = await page.evaluate(async () => { await flushAllSaves(); return { names: disk().thermal_reports.A.pages['0'].data.markers.map(m => m.label), page: state.activePage }; });
    assert(renaming, 'new point opens the inline rename', renaming);
    assert(placed.names.join() === 'Heatsink,PA-1,PA-2' && Math.abs(placed.x - 20) < 1 && placed.armed === 'LNA' && placed.left.join() === 'LNA', 'sequence placement', placed);
    assert(Math.abs(nudged - before - 11) < 0.01, 'arrow nudge (1 + 10 px)', { before, nudged });
    assert(after.names.join() === 'Heatsink,PA-2' && after.page === 0, 'Delete removes the selected point (and does not flip pages)', after);
  });

  await T('標註頁：自動排列不重疊、不蓋到照片；一鍵排版不蓋到標註點；報告檢查列出未命名', async (page) => {
    await page.evaluate(ANNO_SETUP);
    const r = await page.evaluate(async () => {
      const markers = Array.from({ length: 14 }, (_, i) => ({ id: 'm' + i, x: 8 + (i % 7) * 14, y: i < 7 ? 30 : 70, label: i === 13 ? '' : 'COMP-' + i, lx: 400, ly: 250 }));
      await useDb({ thermal_reports: { A: report('A', { 0: { type: 'annotation', order: 0, data: { anno_v: 2, img_fit: true, tc_category: 'RF', photo_url_or_base64: photo(600, 400), img_box: { x: 250, y: 120, w: 342, h: 228 }, markers } } }) } });
      await openReport('A');
      const d = state.pages[0].data;
      const rects = () => annoLabelRects(d, null);
      const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      document.querySelector('[data-an-tool="arrange"]').click();
      const R = rects(), B = d.img_box;
      const arr = { pairs: R.some((a, i) => R.some((b, j) => j > i && overlap(a, b))), onPhoto: R.some(a => overlap(a, { x: B.x, y: B.y, w: B.w, h: B.h })) };
      const before = d.img_box.w;
      document.querySelector('[data-an-tool="layout"]').click();
      const L = rects();
      const dots = d.markers.map(m => annoDot(d, m));
      const lay = { bigger: d.img_box.w > before, pairs: L.some((a, i) => L.some((b, j) => j > i && overlap(a, b))), covers: L.some(a => dots.some(p => p.x > a.x && p.x < a.x + a.w && p.y > a.y && p.y < a.y + a.h)) };
      return { arr, lay, check: runReportCheck().filter(x => x.idx === 0).map(x => x.text) };
    });
    assert(!r.arr.pairs && !r.arr.onPhoto, 'auto arrange', r.arr);
    assert(r.lay.bigger && !r.lay.pairs && !r.lay.covers, 'one-click layout', r.lay);
    assert(r.check.some(t => t.startsWith('1 個標註點未命名')), 'report check', r.check);
  });


  await T('標註頁：小照片填滿框、舊頁（含 90° 旋轉）對齊照片、轉換後第一個修改可復原', async (page) => {
    await page.evaluate(ANNO_SETUP);
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', {
        0: { type: 'annotation', order: 0, data: { anno_v: 2, img_fit: true, tc_category: 'RF', photo_url_or_base64: photo(100, 50), img_box: { x: 200, y: 100, w: 400, h: 200 }, markers: [{ id: 'a', x: 100, y: 100, label: 'corner', lx: 650, ly: 320 }] } },
        1: { type: 'annotation', order: 1, data: { tc_category: 'RF', photo_url_or_base64: photo(200, 100), anno_photo_x: 200, anno_photo_y: 50, anno_photo_w: 400, anno_photo_h: 400, markers: [{ id: 'b', x: 50, y: 25, label: 'top' }] } },
        2: { type: 'annotation', order: 2, data: { tc_category: 'RF', photo_url_or_base64: photo(800, 600), anno_photo_x: 80, anno_photo_y: 60, anno_photo_w: 680, anno_photo_h: 430, anno_rotate: 90, markers: [{ id: 'c', x: 50, y: 0, label: 'edge' }, { id: 'd', x: 50, y: 50, label: 'mid' }] } } }) } });
      await openReport('A');
      await sleep(200);
      const k = annoRect('#an-paper').width / 842;
      const ir = annoRect('#an-img img');
      const small = [Math.round(ir.width / k), Math.round(ir.height / k)];
      selectPage(1); await sleep(300);
      const d1 = state.pages[1].data;
      const letterbox = { fit: d1.img_fit, box: d1.img_box, pt: d1.markers[0].x + ',' + d1.markers[0].y };
      selectPage(2); await sleep(300);
      const d2 = state.pages[2].data;
      const rot = { box: d2.img_box, pts: d2.markers.map(m => m.x + ',' + m.y), ar: d2.img_box.w / d2.img_box.h };
      document.querySelector('[data-an-tool="size"]').click();
      const sized = d2.label_size;
      performUndo();
      return { small, letterbox, rot, sized, undone: state.pages[2].data.label_size || 'M' };
    });
    assert(r.small.join() === '400,200', 'small photo scaled up to its frame', r.small);
    assert(r.letterbox.fit && r.letterbox.box.y === 150 && r.letterbox.box.h === 200 && r.letterbox.pt === '50,0', 'letterboxed old frame fitted, point kept', r.letterbox);
    assert(Math.abs(r.rot.ar - 0.75) < 0.01 && r.rot.pts.join('|') === '50,12.5|50,50', 'rotated old frame keeps the old scale', r.rot);
    assert(r.sized === 'L' && r.undone === 'M', 'first edit after conversion can be undone', r);
  });

  await T('標註頁：雙擊標籤改名、吸附輔助線放開後消失、Esc 關閉亮度面板、其他對話框開著時不吃快捷鍵', async (page) => {
    await page.evaluate(ANNO_SETUP);
    await page.evaluate(async () => {
      const markers = [{ id: 'a', x: 20, y: 50, label: 'PA', lx: 40, ly: 100 }, { id: 'b', x: 80, y: 50, label: 'LNA', lx: 40, ly: 200 }];
      await useDb({ thermal_reports: { A: report('A', { 0: { type: 'annotation', order: 0, data: { anno_v: 2, img_fit: true, tc_category: 'RF', photo_url_or_base64: photo(400, 200), img_box: { x: 220, y: 120, w: 400, h: 200 }, markers } } }) } });
      await openReport('A');
    });
    await page.waitForTimeout(150);
    const center = sel => page.evaluate(sel => { const r = annoRect(sel); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    let c = await center('[data-an-lbl="a"]');
    await page.mouse.dblclick(c.x, c.y);
    const renaming = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('an-rename'));
    await page.keyboard.press('Escape');
    // drag LNA's label next to PA's left edge → snaps, guide hidden afterwards
    c = await center('[data-an-lbl="b"]');
    const k = await page.evaluate(() => annoRect('#an-paper').width / 842);
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x + 3 * k, c.y - 40 * k, { steps: 4 });
    const guideDuring = await page.evaluate(() => getComputedStyle(document.querySelector('.an-guide')).display);
    await page.mouse.up();
    const after = await page.evaluate(() => ({ guide: getComputedStyle(document.querySelector('.an-guide')).display, lx: state.pages[0].data.markers[1].lx }));
    // brightness panel: Esc closes it and drops the live preview
    await page.click('[data-an-tool="adjust"]');
    await page.evaluate(() => { const i = document.querySelector('.an-pop [data-adj="b"]'); i.value = 40; i.dispatchEvent(new Event('input', { bubbles: true })); });
    const filterOn = await page.evaluate(() => document.querySelector('#an-img img').style.filter);
    await page.keyboard.press('Escape');
    const pop = await page.evaluate(() => ({ open: !!document.querySelector('.an-pop'), filter: document.querySelector('#an-img img').style.filter }));
    // another dialog open: Delete must not touch the page behind it
    await page.evaluate(() => { annoSelect(state.pages[0], 'a'); const o = document.createElement('div'); o.className = 'hp-modal-overlay'; document.body.appendChild(o); });
    await page.keyboard.press('Delete');
    const kept = await page.evaluate(() => { document.querySelector('.hp-modal-overlay').remove(); return state.pages[0].data.markers.length; });
    assert(renaming, 'double-click opens rename', renaming);
    assert(guideDuring === 'block' && after.guide === 'none' && after.lx === 40, 'snap + guide cleared', { guideDuring, after });
    assert(filterOn.includes('brightness(1.4)') && !pop.open && pop.filter === '', 'Esc closes the adjust panel', { filterOn, pop });
    assert(kept === 2, 'shortcuts ignored under another dialog', kept);
  });


  console.log('Image page (shared editor / PDF layout) · pagination');

  await T('標註頁兩張照片：自動版面（左右 / 上下）、第二張上加標註、圖片說明（側欄 / 頁面）、編輯器 = PDF、交換、刪除後遞補', async (page) => {
    await page.evaluate(ANNO_SETUP);
    const r1 = await page.evaluate(async () => {
      const markers = [{ id: 'a', x: 25, y: 50, label: 'PA', lx: 60, ly: 150 }, { id: 'b', x: 75, y: 25, label: 'LNA', lx: 680, ly: 100 }];
      await useDb({ thermal_reports: { A: report('A', { 0: { type: 'annotation', order: 0, data: { anno_v: 2, img_fit: true, tc_category: 'RF', photo_url_or_base64: photo(400, 300), img_box: { x: 200, y: 100, w: 400, h: 300 }, markers } } }) } });
      await openReport('A');
      const f = async (n, w, h) => new File([await (await fetch(photo(w, h))).blob()], n, { type: 'image/png' });
      window.__f = f;
      await handleAnnotationPhoto(state.pages[0], await f('p.png', 300, 400));    // portrait second photo
      const d = state.pages[0].data, mid = (ANNO_SAFE.l + ANNO_SAFE.r) / 2;
      const rects = annoLabelRects(d, null);
      return {
        n: annoPhotos(d).length, key: annoCurKey(d), sel: annoUI.photo,
        b0: d.img_box, b1: d.photo2.img_box, mid,
        labelsLeft: rects.every(r => r.x + r.w <= mid), pts: d.markers.map(m => [m.x, m.y].join()).join('|'),
        one: document.querySelector('[data-an-layout="1"]').disabled, imgs: document.querySelectorAll('#an-imglayer [data-an-img]').length,
        add2: !!document.getElementById('an-add2'), addTool: document.querySelector('[data-an-tool="addimg"]').disabled,
      };
    });
    assert(r1.n === 2 && r1.key === '2h' && r1.sel === 1 && r1.imgs === 2, 'second photo added, side by side (auto)', r1);
    assert(r1.b0.x + r1.b0.w <= r1.mid && r1.b1.x >= r1.mid && r1.labelsLeft, 'each photo (and its labels) in its half', r1);
    assert(r1.pts === '25,50|75,25' && r1.one && !r1.add2 && r1.addTool, 'points kept; layout 1 / add disabled with 2 photos', r1);
    // two wide photos → 自動 stacks them
    const r2 = await page.evaluate(async () => {
      await handleAnnotationPhoto(state.pages[0], await __f('w.png', 800, 300), 1);   // replace photo 2
      document.querySelector('[data-an-layout="auto"]').click();
      const d = state.pages[0].data;
      return { key: annoCurKey(d), b0: d.img_box, b1: d.photo2.img_box, midY: (ANNO_SAFE.t + ANNO_SAFE.b) / 2, layout: d.layout };
    });
    assert(r2.key === '2v' && r2.b0.y + r2.b0.h <= r2.midY && r2.b1.y >= r2.midY && r2.layout === 'auto', 'wide photos stack', r2);
    // a point on photo 2 (add mode), named in place
    await page.evaluate(() => annoSetMode(state.pages[0], 'add'));
    const c = await page.evaluate(() => { const r = annoRect('#an-img-1'); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.5 }; });
    await page.mouse.click(c.x, c.y);
    await page.waitForSelector('.an-rename');
    await page.keyboard.type('U2');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');                     // back to select mode
    // captions: side panel (photo 2), on the page via the ghost button (photo 1)
    await page.fill('[data-an-capin="1"]', 'IR 熱像');
    await page.evaluate(() => document.querySelector('[data-an-capin="1"]').dispatchEvent(new Event('change', { bubbles: true })));
    await page.click('[data-an-prow="0"] .an-idx');
    await page.click('[data-an-capedit="0"]');
    await page.waitForSelector('.an-rename');
    await page.keyboard.type('Top view');
    await page.keyboard.press('Enter');
    const r3 = await page.evaluate(async () => {
      await flushAllSaves();
      const d = disk().thermal_reports.A.pages['0'].data;
      const live = state.pages[0].data;
      const pdf = new DOMParser().parseFromString(buildAnnotationHTML(live), 'text/html');
      const geo = el => [el.style.left, el.style.top, el.style.width, el.style.height].join(',');
      const caps = el => Array.from(el.querySelectorAll('div')).filter(x => x.style.fontFamily.includes('Noto Sans TC') && x.style.height === '18px').map(x => x.textContent + '@' + geo(x)).sort().join('|');
      return {
        u2: d.markers.find(m => m.label === 'U2'), caps: [d.caption, d.photo2.caption],
        pdfImgs: pdf.querySelectorAll('img').length,
        sameLabels: Array.from(pdf.querySelectorAll('div[style*="border:1px solid #2357A7"]')).map(geo).join('|') === Array.from(document.querySelectorAll('#an-ov [data-an-lbl]')).map(geo).join('|'),
        sameDots: Array.from(pdf.querySelectorAll('div[style*="border-radius:50%"]')).map(geo).join('|') === Array.from(document.querySelectorAll('#an-ov [data-an-dot]')).map(geo).join('|'),
        pdfCaps: caps(pdf), edCaps: caps(document.getElementById('an-imglayer')),
        foot: [annoFoot(live), annoFoot(live.photo2)].every(F => F.y + F.h <= ANNO_SAFE.b + 0.5),
        groups: Array.from(document.querySelectorAll('#an-list .an-grp')).map(x => x.textContent),
      };
    });
    assert(r3.u2 && r3.u2.p === 1 && r3.u2.x > 20 && r3.u2.x < 40, 'point on photo 2', r3.u2);
    assert(r3.caps.join() === 'Top view,IR 熱像' && r3.foot, 'captions saved, photo + caption on the page', r3);
    assert(r3.pdfImgs === 2 && r3.sameLabels && r3.sameDots && r3.pdfCaps && r3.pdfCaps === r3.edCaps && /Top view/.test(r3.pdfCaps) && /IR 熱像/.test(r3.pdfCaps), 'editor = PDF (photos, labels, captions)', r3);
    assert(r3.groups.length === 2 && /照片 2 · IR 熱像/.test(r3.groups[1]), 'marker list grouped by photo', r3.groups);
    // swap, then delete photo 1: photo 2 moves up
    await page.click('#an-swap');
    const r4 = await page.evaluate(() => { const d = state.pages[0].data; return { cap: d.caption, u2: d.markers.find(m => m.label === 'U2').p, pa: d.markers.find(m => m.label === 'PA').p }; });
    assert(r4.cap === 'IR 熱像' && r4.u2 === undefined && r4.pa === 1, 'swapped with points + captions', r4);
    await page.evaluate(() => annoSelectPhoto(state.pages[0], 0));
    await page.evaluate(() => document.querySelector('[data-an-pdel="0"]').click());
    const r5 = await page.evaluate(async () => {
      await flushAllSaves();
      const d = disk().thermal_reports.A.pages['0'].data;
      return { photo2: 'photo2' in d, cap: d.caption, labels: d.markers.map(m => m.label + ':' + (m.p || 0)).join(), add2: !!document.getElementById('an-add2'), one: document.querySelector('[data-an-layout="1"]').disabled };
    });
    assert(!r5.photo2 && r5.cap === 'Top view' && r5.labels === 'PA:0,LNA:0' && r5.add2 && !r5.one, 'photo 2 became photo 1', r5);
  });

  await T('標註頁兩張照片：說明存檔不吃掉下一個拖曳、雙擊說明可改、上下版面換照片不蓋到另一張、編號依照片排、範本留下的標註點列出', async (page) => {
    await page.evaluate(ANNO_SETUP);
    await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: { type: 'annotation', order: 0, data: { anno_v: 2, img_fit: true, tc_category: 'RF', photo_url_or_base64: photo(800, 300), img_box: { x: 100, y: 100, w: 640, h: 240 }, markers: [{ id: 'a', x: 20, y: 50, label: '' }] } } }) } });
      await openReport('A');
      window.__f = async (n, w, h) => new File([await (await fetch(photo(w, h))).blob()], n, { type: 'image/png' });
      await handleAnnotationPhoto(state.pages[0], await __f('w.png', 800, 300));   // two wide photos → stacked
    });
    // type a caption, then drag photo 1 straight away: the blur saves the caption, the drag still moves the photo
    await page.fill('[data-an-capin="0"]', 'Top');
    const x0 = await page.evaluate(() => state.pages[0].data.img_box.x);
    const c0 = await page.evaluate(() => { const r = annoRect('#an-img'); return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.3 }; });
    const k = await page.evaluate(() => annoRect('#an-paper').width / 842);
    await page.mouse.move(c0.x, c0.y); await page.mouse.down(); await page.mouse.move(c0.x - 40 * k, c0.y, { steps: 5 }); await page.mouse.up();
    const r1 = await page.evaluate(() => ({ key: annoCurKey(state.pages[0].data), cap: state.pages[0].data.caption, x: state.pages[0].data.img_box.x }));
    assert(r1.key === '2v' && r1.cap === 'Top' && Math.abs(r1.x - (x0 - 40)) < 2, 'caption saved and the drag moved the photo', { ...r1, x0 });
    // double-click the caption on the page → edit it there
    const cap = await page.evaluate(() => { const r = annoRect('[data-an-cap="0"]'); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.dblclick(cap.x, cap.y);
    const edit = await page.evaluate(() => { const i = document.querySelector('.an-rename'); return i && i.value; });
    await page.keyboard.press('Escape');
    assert(edit === 'Top', 'double-click opens the caption editor', edit);
    // replace photo 1 with a 4:3 photo: it stays in the top half
    const r2 = await page.evaluate(async () => {
      await handleAnnotationPhoto(state.pages[0], await __f('q.png', 400, 300), 0);
      const d = state.pages[0].data, A = annoFoot(d), B = annoFoot(d.photo2);
      return { overlap: A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h, A, B };
    });
    assert(!r2.overlap, 'replacement keeps clear of the other photo', r2);
    // a point added on photo 2, then one on photo 1: numbers still run photo by photo; also after a swap
    const addAt = async (sel, fx, fy) => {
      await page.evaluate(() => annoSetMode(state.pages[0], 'add'));
      const q = await page.evaluate(([sel, fx, fy]) => { const r = annoRect(sel); return { x: r.left + r.width * fx, y: r.top + r.height * fy }; }, [sel, fx, fy]);
      await page.mouse.click(q.x, q.y);
      await page.waitForSelector('.an-rename');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    };
    await addAt('#an-img-1', 0.5, 0.5);
    await addAt('#an-img', 0.7, 0.6);
    const order = () => page.evaluate(() => state.pages[0].data.markers.map(m => annoPi(m)).join(''));
    const o1 = await order();
    await page.click('#an-swap');
    const o2 = await order();
    const names = await page.evaluate(() => { const d = state.pages[0].data; return annoMk(d, 0).map(m => annoMarkerName(m, d.markers.indexOf(m))).join(); });
    assert(o1 === '001' && o2 === '011' && names === 'TC1', 'markers grouped by photo', { o1, o2, names });
    // template copy without photos, one photo added back: photo-2 points are listed (not hidden)
    const r3 = await page.evaluate(async () => {
      const d = state.pages[0].data;
      d.photo2.photo_url_or_base64 = '';
      annoNormalize(d);
      renderAnnotationPage(state.pages[0]);
      return { photo2: !!d.photo2, groups: Array.from(document.querySelectorAll('#an-list .an-grp')).map(x => x.textContent), rows: document.querySelectorAll('#an-list [data-an-row]').length, n: d.markers.length };
    });
    assert(r3.photo2 && r3.groups.length === 2 && /尚未放入/.test(r3.groups[1]) && r3.rows === r3.n, 'orphan points listed', r3);
  });

  await T('圖片頁：舊資料轉換（版面、旋轉翻轉、平移縮放與標註），編輯器與 PDF 相同', async (page) => {
    await page.evaluate(ANNO_SETUP);
    const r = await page.evaluate(async () => {
      const old = { title: 'IR', col_split: 60, images: [
        { position: 0, url_or_base64: photo(400, 300), caption: 'A', zoom: 1.5, off_x: 10, markers: [{ id: 'm1', x: 50, y: 50, label: 'hot', label_x: 70, label_y: 10, label_w: 90 }], circles: [{ id: 'c1', x: 40, y: 40, w: 20, h: 20, label: 'zone', label_x: 5, label_y: 80 }] },
        { position: 1, url_or_base64: '', caption: '' },
        { position: 2, url_or_base64: photo(300, 400), caption: '', rotate: 90, flip_v: true } ] };
      await useDb({ thermal_reports: { A: report('A', { 0: { type: 'image', order: 0, data: old } }) } });
      await openReport('A');
      await sleep(400);
      await flushAllSaves();
      const d = disk().thermal_reports.A.pages['0'].data;
      const pdf = new DOMParser().parseFromString(buildImagePageHTML(state.pages[0].data), 'text/html');
      const geo = el => [el.style.left, el.style.top, el.style.width, el.style.height].join(',');
      const pick = (root, sel) => Array.from(root.querySelectorAll(sel)).map(geo);
      return { v: d.im_v, layout: d.layout, split: d.split, n: d.images.length, rot: d.images[1].rot, fh: d.images[1].fh, nar: d.images.map(im => im.nar), z: d.images[0].z, legacy: 'zoom' in d.images[0] || 'markers' in d.images[0],
        co: d.images[0].callouts.map(c => c.type + ':' + c.label), cx: d.images[0].cx,
        pdfLbl: pick(pdf, 'div[style*="border:1px solid #2357A7"]'), edLbl: pick(document, '#im-ov [data-im-lbl]'),
        pdfShape: pick(pdf, 'div[style*="border:2px solid #dc2626"]'), edShape: pick(document, '[data-im-shape]') };
    });
    assert(r.v === 2 && r.layout === '2h' && r.split.c === 60 && r.n === 2, 'layout / empty placeholder dropped', r);
    assert(r.rot === 270 && r.fh === true && r.nar.join() === '1.33333,0.75', 'rotation + flip converted, sizes learnt', r);
    assert(!r.legacy && r.z > 0.9 && r.z < 0.96 && r.cx < 0.5 && r.co.join() === 'dot:hot,circle:zone', 'pan / zoom / markers converted (same zoom relative to the old cell)', r);
    assert(r.pdfLbl.length === 2 && r.pdfLbl.join('|') === r.edLbl.join('|') && r.pdfShape.join('|') === r.edShape.join('|'), 'editor = PDF geometry', r);
  });

  await T('圖片頁：標註跟著照片（放大 / 平移 / 旋轉）、畫圈選並就地命名、文字框', async (page) => {
    await page.evaluate(ANNO_SETUP);
    await page.evaluate(async () => {
      const im = { url_or_base64: photo(400, 200), caption: 'Board', nar: 2, rot: 0, fh: false, callouts: [{ id: 'd1', type: 'dot', x: 0.25, y: 0.5, label: 'U1', lx: 700, ly: 100 }] };
      await useDb({ thermal_reports: { A: report('A', { 0: { type: 'image', order: 0, data: { im_v: 2, title: 'T', layout: 'auto', split: { c: 50, r: 50 }, images: [im], texts: [] } } }) } });
      await openReport('A');
    });
    const r1 = await page.evaluate(async () => {
      const d = state.pages[0].data, at = () => { const g = imCalloutGeo(d)[0]; return [Math.round(g.px - (g.R.x + 0.25 * g.R.w)), Math.round(g.py - (g.R.y + 0.5 * g.R.h))].join(); };
      imSelect(state.pages[0], null, 0);
      await imTool(state.pages[0], 'zin'); await imTool(state.pages[0], 'zin');
      const zoomed = { z: d.images[0].z, on: at() };
      await imTool(state.pages[0], 'rotr');
      const rot = d.images[0].callouts[0].x + ',' + d.images[0].callouts[0].y;
      await imTool(state.pages[0], 'rotl');
      return { zoomed, rot };
    });
    // circle mode: drag on the photo, type a name
    await page.keyboard.press('c');
    const f = await page.evaluate(() => { const r = annoRect('[data-im-frame="0"]'); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await page.mouse.move(f.x + f.w * 0.55, f.y + f.h * 0.4); await page.mouse.down();
    await page.mouse.move(f.x + f.w * 0.7, f.y + f.h * 0.6, { steps: 5 }); await page.mouse.up();
    await page.waitForTimeout(100);
    await page.keyboard.type('Hot zone'); await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    // text box
    await page.keyboard.press('t');
    await page.mouse.click(f.x + 20, f.y + f.h - 20);
    await page.waitForTimeout(100);
    await page.keyboard.type('Airflow →'); await page.keyboard.press('Enter');
    const r2 = await page.evaluate(async () => { await flushAllSaves(); const d = disk().thermal_reports.A.pages['0'].data; return { co: d.images[0].callouts.map(c => c.type + ':' + c.label + ':' + (c.w ? c.w.toFixed(2) : '-')), texts: d.texts.map(t => t.label), pdf: buildImagePageHTML(state.pages[0].data).includes('Airflow →') }; });
    assert(r1.zoomed.z > 1.5 && r1.zoomed.on === '0,0', 'callout stays on the photo when zoomed', r1);
    assert(r1.rot === '0.5,0.25', 'callout rotates with the photo', r1);
    assert(r2.co.length === 2 && r2.co[1].startsWith('circle:Hot zone:') && parseFloat(r2.co[1].split(':')[2]) > 0.05, 'circle drawn + named', r2);
    assert(r2.texts.join() === 'Airflow →' && r2.pdf, 'text box', r2);
  });

  await T('圖片頁：加入多張自動版面、拖到另一格交換、拖格線、版面容量、Delete 刪除', async (page) => {
    await page.evaluate(ANNO_SETUP);
    await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: { type: 'image', order: 0, data: { im_v: 2, title: 'T', layout: 'auto', split: { c: 50, r: 50 }, images: [], texts: [] } } }) } });
      await openReport('A');
      const f = async (n, w, h) => new File([await (await fetch(photo(w, h))).blob()], n, { type: 'image/png' });
      await imAddFiles(state.pages[0], [await f('b.png', 300, 200), await f('a.png', 300, 200), await f('c.png', 200, 300)]);
    });
    await page.waitForTimeout(150);
    const a = await page.evaluate(() => ({ caps: state.pages[0].data.images.map(im => im.caption).join(), layout: imLayoutKey(state.pages[0].data), dis3h: document.querySelector('[data-im-layout="1"]').disabled }));
    const c = async i => page.evaluate(i => { const r = annoRect(`[data-im-frame="${i}"]`); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, i);
    const p0 = await c(0), p1 = await c(1);
    await page.mouse.move(p0.x, p0.y); await page.mouse.down(); await page.mouse.move(p1.x, p1.y, { steps: 8 }); await page.mouse.up();
    const swapped = await page.evaluate(() => state.pages[0].data.images.map(im => im.caption).join());
    const g = await page.evaluate(() => { const r = annoRect('[data-im-handle="gc"]'); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const k = await page.evaluate(() => annoRect('#an-paper').width / 842);
    await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x + 100 * k, g.y, { steps: 5 }); await page.mouse.up();
    const split = await page.evaluate(() => state.pages[0].data.split.c);
    await page.evaluate(() => imSelect(state.pages[0], null, 2));
    await page.keyboard.press('Delete');
    const after = await page.evaluate(async () => { await flushAllSaves(); return disk().thermal_reports.A.pages['0'].data.images.map(im => im.caption).join(); });
    assert(a.caps === 'a,b,c' && a.layout === '1+2' && a.dis3h, 'sorted, captions, auto layout, capacity', a);
    assert(swapped === 'b,a,c', 'drag onto another slot swaps', swapped);
    assert(split > 60, 'gutter drag', split);
    assert(after === 'b,a', 'Delete removes the selected image (after confirm)', after);
  });

  await T('換頁：感測器 / 比對 / 比較表不論列高都不會壓到頁尾', async (page) => {
    const r = await page.evaluate(async () => {
      const comps = Array.from({ length: 14 }, (_, i) => comp(i % 3 ? 'U' + i : 'Very long component name that wraps around PA_GaN_U' + i, { ta_25: '60', ta_55: '90' }, 125, '0.90', { uid: 'u' + i, note: i % 4 ? '' : 'a fairly long note that wraps onto two lines' }));
      const sensors = Array.from({ length: 45 }, (_, i) => ({ name: 'sensor ' + i, type: 'Local', readings: { ta_25: '61', ta_55: '91' }, ref: i % 2 ? null : { uid: 'u' + (i % 14) } }));
      await useDb({ thermal_reports: { A: report('A', {
        0: { id: 'dp', ...dataPage(0, comps, [25, 55], { sensors }) },
        1: { type: 'sim_vs_meas', order: 1, data: { compare_ta: 55, items: comps.map(c => ({ component_name: c.name, sim_tc: '88', source_page: 'dp', source_uid: c.uid, note: 'model note that is long enough to wrap in the narrow column' })) } } }) } });
      await openReport('A');
      await document.fonts.ready;
      const vps = buildVirtualPages();
      const box = document.createElement('div');
      box.style.cssText = `position:fixed;left:0;top:0;width:842px;height:595px;overflow:hidden;font-family:${PDF_FONT};z-index:99999;background:#fff;`;
      document.body.appendChild(box);
      const res = vps.map(vp => { box.innerHTML = '<div style="width:100%;height:100%;">' + vp.html + '</div>'; const t = box.getBoundingClientRect().top; const trs = Array.from(box.querySelectorAll('tbody tr')); return { type: vp.page.type, rows: trs.length, max: Math.max(0, ...trs.map(tr => tr.getBoundingClientRect().bottom - t)) }; });
      box.remove();
      const total = t => res.filter(x => x.type === t).reduce((a, x) => a + x.rows, 0);
      return { res, dataRows: total('data'), simRows: total('sim_vs_meas') };
    });
    assert(r.res.every(x => x.max <= 548), 'no row below the footer limit', r.res);
    assert(r.dataRows === 14 + 45 && r.simRows === 14, 'every row printed exactly once', r);
  });

  await T('PDF 頁尾：灰色註釋與頁碼都實際量測，PDF 渲染（html2canvas 複本）中表格列不會壓到', async (page) => {
    const r = await page.evaluate(async () => {
      const zh = ['功率放大器', '數位前端晶片', '電源模組', '低雜訊放大器', '收發器'];
      const comps = Array.from({ length: 30 }, (_, i) => comp(zh[i % 5] + ' U' + i + (i % 4 ? '' : ' 長名稱測試元件'), { ta_25: '60', ta_55: '90' }, 125, '0.90', { uid: 'u' + i, note: i % 3 ? '' : '備註：散熱片接觸' }));
      const sensors = Array.from({ length: 40 }, (_, i) => ({ name: i % 2 ? 'Temp Sensor(LA' + i + ')' : 'H-RF sensor 49281-' + i, type: i % 3 ? 'Remote' : 'Local', readings: { ta_25: '61', ta_55: '91' }, ref: i % 2 ? null : { uid: 'u' + (i % 30) }, note: i % 5 ? '' : '溫度感測器備註' }));
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A'), 1: { id: 'dp', ...dataPage(1, comps, [25, 55], { sensors }) } }) } });
      await openReport('A');
      // a footer that wraps onto several lines lowers the room by itself
      const tall = pgMeasure(wrapPageHTML(`<div style="padding:28px;">x${PG_END}</div><div data-pg-foot style="position:absolute;left:32px;right:32px;bottom:27px;font-size:7px;line-height:10px;">a<br>b<br>c<br>d</div>`));
      // what html2canvas lays out (its cloned document), page by page
      const clone = [];
      const orig = html2canvas;
      window.html2canvas = (el, opts) => orig(el, { ...opts, onclone: async (doc, ref) => {
        await opts.onclone(doc, ref);
        const t = ref.getBoundingClientRect().top;
        const trs = Array.from(ref.querySelectorAll('tbody tr'));
        const foots = Array.from(ref.querySelectorAll('[data-pg-foot]'), f => f.getBoundingClientRect().top - t);
        clone.push({ rows: trs.length, last: Math.max(0, ...trs.map(tr => tr.getBoundingClientRect().bottom - t)), foot: Math.min(999, ...foots), nFoot: foots.length });
      } });
      const Orig = jspdf.jsPDF;
      window.jspdf = { jsPDF: function (...a) { const inst = new Orig(...a); inst.save = () => {}; return inst; } };
      await exportPDF();
      window.html2canvas = orig;
      return { tall, clone };
    });
    assert(Math.abs(r.tall.room - (595 - 27 - 40 - 10)) < 1.5, 'room follows the footer height', r.tall);
    const data = r.clone.slice(1);
    assert(data.length >= 4 && data.every(p => p.nFoot >= 1) && data.slice(0, 3).every(p => p.nFoot === 2), 'note + page number marked', r.clone);
    assert(data.every(p => p.last <= p.foot - 8), 'no row under a footer line', r.clone);
    assert(data.reduce((a, p) => a + p.rows, 0) === 30 + 40, 'every row printed once', r.clone);
  });


  await T('圖片頁：舊標註依舊版格子換算位置；側欄排序在點選後仍可用；還原裁切保留之後的標註；方向鍵不超出', async (page) => {
    await page.evaluate(ANNO_SETUP);
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', {
        0: { type: 'image', order: 0, data: { title: 'One', images: [{ position: 0, url_or_base64: photo(400, 300), caption: '', markers: [{ id: 'a', x: 30, y: 40, label: 'p', label_x: 10, label_y: 10 }] }] } },
        1: { type: 'image', order: 1, data: { title: 'Grid', images: [{ position: 0, url_or_base64: photo(300, 200), caption: '' }, { position: 1, url_or_base64: '', caption: '' }, { position: 2, url_or_base64: photo(300, 200), caption: '', markers: [{ id: 'b', x: 50, y: 25, label: 'q', label_x: 10, label_y: 10 }] }] } } }) } });
      await openReport('A');
      await sleep(400);
      const one = state.pages[0].data.images[0].callouts[0], grid = state.pages[1].data.images[1].callouts[0];
      // sortable survives a photo click (side panel refresh)
      selectPage(1);
      await sleep(100);
      const fr = document.querySelector('[data-im-frame="0"]').getBoundingClientRect();
      const down = new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: fr.left + 10, clientY: fr.top + 10, pointerId: 1 });
      document.querySelector('[data-im-frame="0"]').dispatchEvent(down);
      document.getElementById('an-paper').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: fr.left + 10, clientY: fr.top + 10, pointerId: 1 }));
      const sortable = !!(window.Sortable && Sortable.get(document.getElementById('im-list')));
      return { one: [one.x, one.y], grid: [grid.x, grid.y], sortable, sel: imUI.selImg };
    });
    assert(Math.abs(r.one[0] - 0.108) < 0.006 && Math.abs(r.one[1] - 0.333) < 0.006, 'single photo: old cell math', r.one);
    assert(Math.abs(r.grid[0] - 0.5) < 0.006 && Math.abs(r.grid[1] - 0.194) < 0.006, 'old 2×2 with a placeholder: old cell math', r.grid);
    assert(r.sortable && r.sel === 0, 'sortable after a photo click', r);
    // crop (whole photo) → add / rename callouts → uncrop keeps them
    await page.evaluate(() => imSelect(state.pages[1], null, 1));
    await page.click('[data-im-tool="crop"]');
    await page.waitForSelector('.crop-modal .confirm');
    await page.click('.crop-modal .confirm');
    await page.waitForTimeout(300);
    const r2 = await page.evaluate(async () => {
      const im = state.pages[1].data.images[1];
      im.callouts[0].label = 'renamed';
      im.callouts.push({ id: 'n1', type: 'dot', x: 0.2, y: 0.2, label: 'new', lx: 600, ly: 100 });
      await imTool(state.pages[1], 'uncrop');
      // arrow nudge stays inside the page
      imSelect(state.pages[1], 'n1', 1);
      return { co: im.callouts.map(c => c.id + ':' + c.label).join() };
    });
    for (let i = 0; i < 40; i++) await page.keyboard.press('Shift+ArrowRight');
    const maxX = await page.evaluate(() => state.pages[1].data.images[1].callouts.find(c => c.id === 'n1').lx);
    await page.keyboard.press('ArrowLeft');
    const back = await page.evaluate(() => state.pages[1].data.images[1].callouts.find(c => c.id === 'n1').lx);
    assert(r2.co === 'b:renamed,n1:new', 'uncrop keeps later callouts', r2);
    assert(maxX < 824 && Math.abs(maxX - back - 1) < 0.01, 'arrow nudge clamped', { maxX, back });
  });

  await T('批次 / 備註轉成的圖片頁一建立就知道照片大小；預覽與 PDF 同字型；換頁搜尋次數少', async (page) => {
    await page.evaluate(ANNO_SETUP);
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A'), 1: { type: 'note', order: 1, data: { title: 'n', blocks: [{ id: 'b', time: 't', text: 'IR', images: [{ name: 'ir.png', url: photo(200, 150) }] }] } } }) } });
      await openReport('A');
      const f = async n => new File([await (await fetch(photo(200, 150))).blob()], n, { type: 'image/png' });
      await insertImagePagesFromFiles([await f('a.png'), await f('b.png')], { perPage: 1, captions: false, afterIdx: 0 });
      const batch = state.pages.filter(p => p.type === 'image').map(p => p.data.images[0].nar);
      selectPage(state.pages.findIndex(p => p.type === 'note'));
      document.querySelector('[data-note-to-image="0"]').click();
      await sleep(300);
      const note = state.pages.filter(p => p.type === 'image').map(p => p.data.images[0].nar);
      openPreview();
      const pvFont = document.querySelector('.pv-page').style.fontFamily;
      closePreview();
      let calls = 0;
      const got = pgMax(1, 1000, e => { calls++; return e <= 37; });
      return { batch, note, pvFont, got, calls };
    });
    assert(r.batch.length === 2 && r.batch.every(x => Math.abs(x - 4 / 3) < 0.001), 'batch pages know the photo size', r.batch);
    assert(r.note.length === 3 && r.note.every(x => Math.abs(x - 4 / 3) < 0.001), 'note → image page learns the size', r.note);
    assert(r.pvFont.includes('Space Grotesk'), 'preview uses the PDF font', r.pvFont);
    assert(r.got === 37 && r.calls <= 14, 'galloping pagination search', r);
  });

  console.log('New version → save, then reload');

  // Serve index.html stamped with `build.served` and version.json with `build.online`
  // (what the Pages deploy does); a reload with ?v=<x> starts serving build x.
  const versionRoutes = (build) => async (ctx) => {
    await ctx.route(/\/index\.html(\?.*)?$/, async (route) => {
      const m = /[?&]v=([^&]+)/.exec(route.request().url());
      if (m) build.served = decodeURIComponent(m[1]);
      build.loads.push(route.request().url());
      const resp = await route.fetch();
      route.fulfill({ response: resp, body: (await resp.text()).replace(/__BUILD_VERSION__/g, build.served) });
    });
    await ctx.route(/\/version\.json(\?.*)?$/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: build.online }) }));
  };

  {
    const build = { served: 'build-A', online: 'build-B', loads: [] };
    await T('新版本上線：倒數提示 → 先存檔 → 帶 ?v= 重新載入 → 回到原本的報告', async (page) => {
      let lastDisk = null;
      await page.exposeFunction('__report', t => { lastDisk = t; });
      const r1 = await page.evaluate(async () => {
        await useDb({ thermal_reports: { A: report('A', { 0: cover('A'), 1: dataPage(1, [comp('PA', {})]) }) } });
        const orig = __h.createWritable;
        __h.createWritable = async () => { const w = await orig(); const c = w.close; w.close = async () => { await c(); window.__report(__h._text); }; return w; };
        await openReport('A');
        selectPage(1);
        const inp = document.querySelector('input[data-comp="0"][data-ta-key="ta_55"]');
        inp.focus(); inp.value = '88.8'; inp.dispatchEvent(new Event('input'));
        const pendingBefore = hasPendingSaves();
        await checkAppVersion();
        const notice = document.getElementById('update-notice').textContent.replace(/\s+/g, ' ');
        return { pendingBefore, notice, version: APP_VERSION };
      });
      assert(r1.version === 'build-A' && r1.pendingBefore && /build-A → build-B/.test(r1.notice) && /10 秒後自動更新/.test(r1.notice) && /回到目前的報告/.test(r1.notice), 'notice', r1);
      await Promise.all([
        page.waitForURL(/[?&]v=build-B/, { waitUntil: 'commit' }),
        page.evaluate(() => document.getElementById('update-now').click()),
      ]);
      await page.waitForLoadState('load');
      await page.waitForTimeout(300);
      const saved = JSON.parse(lastDisk).thermal_reports.A.pages['1'].data.components[0].readings.ta_55;
      const r2 = await page.evaluate(() => ({ search: location.search, version: APP_VERSION, guard: sessionStorage.getItem('trb_update_attempt'), resume: JSON.parse(sessionStorage.getItem('trb_update_resume')), notice: !!document.getElementById('update-notice') }));
      assert(saved === '88.8', 'saved before reload', saved);
      assert(r2.search === '' && r2.version === 'build-B' && r2.guard === null && r2.resume.reportId === 'A' && r2.resume.page === 1 && !r2.notice, 'reloaded on the new build', r2);
      // database ready again → the report reopens on the same page
      await page.evaluate(SETUP);
      const r3 = await page.evaluate(async (disk) => {
        await useDb(JSON.parse(disk));
        await resumeAfterUpdate();
        return { report: state.reportId, page: state.activePage, left: sessionStorage.getItem('trb_update_resume') };
      }, lastDisk);
      assert(r3.report === 'A' && r3.page === 1 && r3.left === null, 'resumed', r3);
    }, { __setup: versionRoutes(build) });
  }

  {
    const build = { served: 'build-A', online: 'build-B', loads: [] };
    await T('新版本上線但存檔失敗（檔案衝突）→ 不重新載入，顯示原因可重試；重載兩次仍是舊版 → 提示列', async (page) => {
      const r = await page.evaluate(async () => {
        await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }) } });
        await openReport('A');
        await flushAllSaves();
        __h._mtime += 1000;                       // someone else wrote the file
        const dept = document.querySelector('[data-field="dept"]');
        dept.value = 'X'; dept.dispatchEvent(new Event('input'));
        await checkAppVersion();
        document.getElementById('update-now').click();
        await sleep(500);
        const err = document.getElementById('update-notice').textContent.replace(/\s+/g, ' ');
        const href = location.href;
        // loop guard: this build was already reloaded twice for build-B
        appUpdate = null; renderUpdateNotice();
        sessionStorage.setItem('trb_update_attempt', JSON.stringify({ to: 'build-B', n: 2 }));
        await checkAppVersion();
        const banner = document.getElementById('update-notice');
        return { err, sameUrl: href === location.href, bannerCls: banner.className, banner: banner.textContent };
      });
      assert(/存檔失敗/.test(r.err) && /衝突/.test(r.err) && /重試/.test(r.err) && r.sameUrl, 'no reload over unsaved data', r);
      assert(r.bannerCls === 'update-banner' && /尚未生效/.test(r.banner), 'loop guard', r);
      assert(build.loads.length === 1, 'never reloaded', build.loads);
    }, { __setup: versionRoutes(build) });
  }

  // A real host (not 127.x) serving the repo files with a Last-Modified date of
  // `site.online`, index.html stamped with `site.stamp` (null = unstamped, i.e.
  // the branch build) and version.json reporting `site.versionJson`.
  const pagesSite = (site) => async (ctx) => {
    await ctx.route(/^https:\/\/trb\.test\//, async (route) => {
      const req = route.request();
      const rel = req.url().replace(/^https:\/\/trb\.test\/app\//, '').replace(/[?#].*$/, '') || 'index.html';
      const headers = { 'last-modified': new Date(site.online).toUTCString(), 'cache-control': 'max-age=600' };
      if (req.method() === 'HEAD') { site.heads++; return route.fulfill({ status: 200, headers: { ...headers, 'content-type': 'text/html' }, body: '' }); }
      if (rel === 'version.json') return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ version: site.versionJson }) });
      const resp = await route.fetch({ url: site.local + rel });
      let body = await resp.body();
      if (rel === 'index.html') { site.loads.push(req.url()); if (site.stamp) body = body.toString('utf8').replace(/__BUILD_VERSION__/g, site.stamp); }
      route.fulfill({ status: resp.status(), headers: { ...resp.headers(), ...headers }, body });
    });
  };
  const PLACEHOLDER = '__BUILD_' + 'VERSION__';
  const T0 = Date.parse('2026-10-07T03:28:05Z');

  {
    const site = { online: T0, stamp: null, versionJson: PLACEHOLDER, local: '', loads: [], heads: 0 };
    await T('未蓋版本號的線上版（Pages 從分支部署）：以頁面日期偵測新部署 → 重新載入新版', async (page) => {
      site.local = page.__url.replace(/index\.html$/, '');
      await page.goto('https://trb.test/app/', { waitUntil: 'load' });
      await page.evaluate(SETUP);
      const r1 = await page.evaluate(async () => {
        await checkAppVersion();
        return { dev: APP_IS_DEV, local: APP_IS_LOCAL, doc: DOC_MODIFIED, notice: !!document.getElementById('update-notice') };
      });
      assert(r1.dev && !r1.local && r1.doc === T0 && !r1.notice && site.heads === 1, 'same deploy → nothing', { ...r1, heads: site.heads });
      site.online = T0 + 3600e3;                    // next push deployed
      const r2 = await page.evaluate(async () => {
        await checkAppVersion();
        return { to: appUpdate && appUpdate.to, notice: document.getElementById('update-notice').textContent.replace(/\s+/g, ' ') };
      });
      assert(r2.to === 'lm-' + (site.online / 1000) && /\d{4}\/\d\d\/\d\d \d\d:\d\d 版 → \d{4}\/\d\d\/\d\d \d\d:\d\d 版/.test(r2.notice) && !r2.notice.includes(PLACEHOLDER), 'notice', r2);
      await Promise.all([
        page.waitForURL(/[?&]v=lm-\d+/, { waitUntil: 'commit' }),
        page.evaluate(() => document.getElementById('update-now').click()),
      ]);
      await page.waitForLoadState('load');
      await page.waitForTimeout(300);
      const r3 = await page.evaluate(async () => {
        await checkAppVersion();
        return { doc: DOC_MODIFIED, guard: sessionStorage.getItem('trb_update_attempt'), notice: !!document.getElementById('update-notice'), search: location.search };
      });
      assert(r3.doc === site.online && r3.guard === null && !r3.notice && r3.search === '' && site.loads.length === 2, 'reloaded on the new deploy', { ...r3, loads: site.loads });
    }, { __setup: pagesSite(site) });
  }

  {
    const site = { online: T0, stamp: 'build-A', versionJson: PLACEHOLDER, local: '', loads: [], heads: 0 };
    await T('已蓋版本號但線上版沒蓋（同一次 push 的分支部署較晚到）→ 不重載同一版；之後的部署才更新', async (page) => {
      site.local = page.__url.replace(/index\.html$/, '');
      await page.goto('https://trb.test/app/', { waitUntil: 'load' });
      await page.evaluate(SETUP);
      site.online = T0 + 30e3;                      // the branch build of the same push
      const r1 = await page.evaluate(async () => { await checkAppVersion(); return { v: APP_VERSION, notice: !!document.getElementById('update-notice') }; });
      assert(r1.v === 'build-A' && !r1.notice, 'twin deploy ignored', r1);
      site.online = T0 + 3600e3;                    // a later push, again only unstamped online
      const r2 = await page.evaluate(async () => { await checkAppVersion(); return { to: appUpdate && appUpdate.to, notice: document.getElementById('update-notice').textContent.replace(/\s+/g, ' ') }; });
      assert(r2.to === 'lm-' + (site.online / 1000) && /build-A → /.test(r2.notice), 'later deploy', r2);
      // a stamped build online always wins
      site.versionJson = 'build-B';
      const r3 = await page.evaluate(async () => { appUpdate = null; renderUpdateNotice(); await checkAppVersion(); return appUpdate && appUpdate.to; });
      assert(r3 === 'build-B', 'stamp first', r3);
    }, { __setup: pagesSite(site) });
  }

  await T('本機開發版（未蓋版本號、localhost）不檢查更新', async (page) => {
    const r = await page.evaluate(async () => { await checkAppVersion(); return { dev: APP_IS_DEV, notice: !!document.getElementById('update-notice') }; });
    assert(r.dev && !r.notice, 'dev build', r);
  }, { __setup: async (ctx) => { await ctx.route(/\/version\.json/, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"build-Z"}' })); } });

  console.log('Stability');

  await T('default dates use the local calendar day', async (page) => {
    const r = await page.evaluate(async () => {
      await useDb({ thermal_reports: {} });
      await createNewReport('X', 'M', 'DVT', '2026-10-06');
      addCoverPage();
      return state.pages[1].data.date;
    });
    assert(r === '2026-10-06', 'local date', r);
  }, { timezoneId: 'Asia/Taipei', __clock: new Date('2026-10-06T07:30:00+08:00') });

  await T('annotation re-renders do not leak document listeners', async (page) => {
    await page.evaluate(() => {
      window.__cnt = 0;
      const orig = document.addEventListener.bind(document);
      document.addEventListener = (t, fn, o) => { if (t === 'mousemove' || t === 'pointermove') window.__cnt++; return orig(t, fn, o); };
    });
    const r = await page.evaluate(async () => {
      const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const markers = [1, 2, 3].map(i => ({ id: 'm' + i, x: 10 * i, y: 10 * i, label: 'TC' + i, label_x: 50, label_y: 10 * i }));
      await useDb({ thermal_reports: { A: report('A', { 0: { type: 'annotation', order: 0, data: { tc_category: 'RF', photo_url_or_base64: px, markers } } }) } });
      await openReport('A');
      await sleep(200);
      const before = __cnt;
      for (let i = 0; i < 10; i++) { renderAnnotationPage(state.pages[0]); annoRenderOverlay(state.pages[0]); }
      return __cnt - before;
    });
    assert(r === 0, 'listener leak', r);
  });

  await T('Ctrl+Shift+Z redoes', async (page) => {
    await page.evaluate(async () => {
      await useDb({ thermal_reports: { A: report('A', { 0: cover('A') }) } });
      await openReport('A');
      const inp = document.querySelector('[data-field="dept"]');
      inp.value = 'X1'; inp.dispatchEvent(new Event('input'));
      await flushAllSaves();
      document.activeElement.blur();
      performUndo();
    });
    await page.keyboard.press('Control+Shift+Z');
    const v = await page.evaluate(() => state.pages[0].data.dept);
    assert(v === 'X1', 'redo shortcut', v);
  });

  await T('rich text is sanitised', async (page) => {
    const r = await page.evaluate(() => sanitizeRichHtml('<b>ok</b><img src=x onerror="window.__x=1"><mark class="concl-hl" onclick="1">hl</mark><script>window.__x=2</script>'));
    assert(!/onerror|onclick|<img|<script/i.test(r) && r.includes('<b>ok</b>') && r.includes('concl-hl'), 'sanitize', r);
  });

  await T('preview + PDF export run for every page type and clean up', async (page) => {
    const r = await page.evaluate(async () => {
      const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      await useDb({ thermal_reports: { A: report('A', {
        0: cover('A'),
        1: { type: 'image', order: 1, data: { title: 'IR', images: [{ url_or_base64: px, caption: 'c' }] } },
        2: { type: 'annotation', order: 2, data: { tc_category: 'RF', photo_url_or_base64: px, markers: [{ id: 'm', x: 10, y: 10, label: 'TC1', label_x: 50, label_y: 10 }] } },
        3: dataPage(3, [comp('PA_U1', { ta_25: '70', ta_55: '95' })]),
        4: { type: 'sim_vs_meas', order: 4, data: { items: [{ component_name: 'PA_U1', category: 'RF', sim_tc: '97' }] } },
        5: { type: 'conclusion', order: 5, data: { summary: '<b>ok</b>', issues: ['i'], actions: [], compliance: [{ component: 'PA_U1' }] } },
        6: { type: 'note', order: 6, data: { title: 'n', blocks: [] } },
      }) } });
      await openReport('A');
      for (let i = 0; i < state.pages.length; i++) selectPage(i);
      openPreview(); closePreview();
      let saved = false;
      const Orig = jspdf.jsPDF;
      window.jspdf = { jsPDF: function (...a) { const inst = new Orig(...a); inst.save = () => { saved = true; }; return inst; } };
      await exportPDF(new Set([0, 1, 2, 3, 4, 5]));
      return { saved, alerts: __alerts, leftovers: document.querySelectorAll('.pdf-offscreen').length, vpages: buildVirtualPages().length };
    });
    assert(r.saved && r.leftovers === 0 && r.vpages === 6, 'export', r);
  });

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
