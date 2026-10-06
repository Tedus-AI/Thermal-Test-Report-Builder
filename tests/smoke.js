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
      const t = document.querySelector('.image-page-title');
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
      // drop 6 files on a fresh image page → fills 4, continues on a new page
      selectPage(1);
      const pg = state.pages[1];
      pg.data.images = [];
      await dropImagesOnImagePage(pg, [1, 2, 3, 4, 5, 6].map(i => f('S' + i + '.png')));
      await flushAllSaves();
      const after = disk().thermal_reports.A.pages;
      return { types, caps, title: state.pages[1].data.title, n1: after['1'].data.images.length, n2: after['2'].data.images.map(im => im.caption).join(), total: Object.keys(after).length };
    });
    assert(r.types.join() === 'cover,image,image,conclusion' && r.caps.join('|') === 'IR_1+IR_2|IR_10+Top.jpg' && r.title === 'IR', 'batch pages', r);
    assert(r.n1 === 4 && r.n2 === 'S5,S6' && r.total === 5, 'multi-drop overflow', r);
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
      return { labels: disk().thermal_reports.A.pages['0'].data.markers.map(m => m.label), list: tds('.anno-comp-name') };
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
      document.addEventListener = (t, fn, o) => { if (t === 'mousemove') window.__cnt++; return orig(t, fn, o); };
    });
    const r = await page.evaluate(async () => {
      const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const markers = [1, 2, 3].map(i => ({ id: 'm' + i, x: 10 * i, y: 10 * i, label: 'TC' + i, label_x: 50, label_y: 10 * i }));
      await useDb({ thermal_reports: { A: report('A', { 0: { type: 'annotation', order: 0, data: { tc_category: 'RF', photo_url_or_base64: px, markers } } }) } });
      await openReport('A');
      await sleep(200);
      const before = __cnt;
      for (let i = 0; i < 20; i++) renderAnnotationMarkers(state.pages[0]);
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
