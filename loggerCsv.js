/* Data-logger CSV / TXT reader for the 數據頁 import (window.loggerCsv).
 *
 * Accepts the usual thermocouple-logger exports (Keysight BenchLink / DAQ970A,
 * Graphtec GL series, Yokogawa, Hioki, Fluke, plain Excel CSV): an optional
 * preamble, one header row, then one row per scan with a time column and one
 * column per channel. Delimiter (, ; tab), quoted cells, unit suffixes
 * ("25.3 C", "+2.53E+01"), comma decimals in ;-files and logger error tokens
 * (OVER / BURNOUT / +++++) are handled.
 *
 * analyze() averages the last N minutes (or N rows when the file has no usable
 * time column) per channel and reports the window's max − min, used as the
 * steady-state check.
 */
(() => {
  'use strict';

  const ERROR_TOKEN = /^(?:[-+]?\s*over|burn\s*-?out|b\.?o\.?|open|err(?:or)?|nan|n\/?a|inf|[-+]?\*+|\+{2,}|-{2,})$/i;
  const INDEX_HEADER = /^(?:no\.?|#|index|scan|sweep|sample|number|num|編號|序號|筆數|資料編號|data\s*no\.?)$/i;
  const TIME_HEADER = /time|date|時間|日期|時刻|elapsed|經過/i;
  const SKIP_HEADER = /^(?:ms|alarm.*|警報.*|unit|單位|status|狀態|marker|event)$/i;

  const stripQuotes = s => {
    s = String(s == null ? '' : s).trim();
    if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') s = s.slice(1, -1).replace(/""/g, '"').trim();
    return s;
  };

  function splitLine(line, delim) {
    if (line.indexOf('"') < 0) return line.split(delim).map(c => c.trim());
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  /** Number in a logger cell, or NaN. `commaDecimal`: "25,3" means 25.3. */
  function cellNumber(cell, commaDecimal) {
    let s = stripQuotes(cell);
    if (!s || ERROR_TOKEN.test(s)) return NaN;
    if (commaDecimal && /^[-+]?\d+,\d+(?:[eE][-+]?\d+)?/.test(s)) s = s.replace(',', '.');
    const m = s.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(?:°\s*[CF]|℃|deg\s*[CF]?|[CFV]|mV|A|W)?$/i);
    return m ? parseFloat(m[1]) : NaN;
  }

  /** Seconds (absolute or since midnight) for a time / date-time cell, or NaN. */
  function cellTime(cell) {
    const s = stripQuotes(cell);
    if (!s) return NaN;
    const tm = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}(?:[.,]\d+)?))?\s*(AM|PM|上午|下午)?/i);
    if (!tm) return NaN;
    let h = +tm[1];
    const ap = (tm[4] || '').toUpperCase();
    if ((ap === 'PM' || ap === '下午') && h < 12) h += 12;
    if ((ap === 'AM' || ap === '上午') && h === 12) h = 0;
    let t = h * 3600 + (+tm[2]) * 60 + (tm[3] ? parseFloat(tm[3].replace(',', '.')) : 0);
    // Date part (only differences matter, so M/D vs D/M ambiguity is harmless within a file).
    const d1 = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    const d2 = !d1 && s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (d1) t += Date.UTC(+d1[1], +d1[2] - 1, +d1[3]) / 1000;
    else if (d2) t += Date.UTC(+d2[3], +d2[1] - 1, +d2[2]) / 1000;
    return t;
  }

  // The delimiter that gives the most lines of one consistent width AND the
  // most numeric cells (so "25,3;26,1" is read as ';' with comma decimals).
  function detectDelimiter(lines) {
    const sample = lines.slice(-40);
    let best = ',', bestScore = -1;
    for (const d of [',', '\t', ';']) {
      const rows = sample.map(l => splitLine(l, d));
      const freq = {};
      rows.forEach(r => { if (r.length > 1) freq[r.length] = (freq[r.length] || 0) + 1; });
      const top = Object.entries(freq).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
      if (!top) continue;
      const w = +top[0], n = top[1];
      const cellsW = rows.filter(r => r.length === w).flat();
      const numeric = cellsW.filter(c => !isNaN(cellNumber(c, d === ';')) || !isNaN(cellTime(c))).length / cellsW.length;
      const score = n * w * (0.5 + numeric);
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  function unitOf(header) {
    const m = String(header).match(/[([]\s*(°?\s*[CF]|℃|deg\s*[CF]?|V|mV|A|W)\s*[)\]]/i) || String(header).match(/(°\s*[CF]|℃)\s*$/i);
    return m ? m[1].replace(/\s+/g, '') : '';
  }

  /**
   * parse(text) → { channels:[{ col, name, unit }], rows:[{ t, v:[…per channel] }],
   *                 timeMode:'time'|'index', timeHeader, delimiter, error? }
   */
  function parse(text) {
    const lines = String(text || '').replace(/^﻿/, '').split(/\r\n|\n|\r/).filter(l => l.trim() !== '');
    if (lines.length < 2) return { error: '檔案內容太少，找不到數據列', channels: [], rows: [] };
    const delim = detectDelimiter(lines);
    const commaDecimal = delim === ';';
    const cells = lines.map(l => splitLine(l, delim));
    // A data row: mostly numbers / clock times / logger error tokens, with at least one number.
    const isDataRow = row => {
      if (row.length < 2) return false;
      let nums = 0, other = 0;
      row.forEach(c => {
        if (!isNaN(cellNumber(c, commaDecimal))) nums++;
        else if (ERROR_TOKEN.test(stripQuotes(c)) || !isNaN(cellTime(c))) other++;
      });
      return nums >= 1 && nums + other >= Math.max(2, Math.ceil(row.length * 0.5));
    };

    // Data block = the last run of data rows (preambles / footers are skipped).
    let end = cells.length - 1;
    while (end >= 0 && !isDataRow(cells[end])) end--;
    if (end < 0) return { error: '找不到數值資料列（請確認是記錄器匯出的 CSV / TXT）', channels: [], rows: [] };
    const width = cells[end].length;
    let start = end;
    while (start - 1 >= 0 && isDataRow(cells[start - 1]) && Math.abs(cells[start - 1].length - width) <= 1) start--;
    // Header = nearest non-data row above the block with about the same width.
    let header = null;
    for (let i = start - 1; i >= 0 && i >= start - 30; i--) {
      if (cells[i].length >= width - 1 && cells[i].length <= width + 1 && !isDataRow(cells[i])) { header = cells[i].map(stripQuotes); break; }
    }
    const data = cells.slice(start, end + 1);
    const names = Array.from({ length: width }, (_, c) => (header && header[c]) || '');

    // Time column: a header that says so, else the first column holding clock times.
    let timeCol = names.findIndex((n, ci) => TIME_HEADER.test(n) && data.slice(0, 20).some(r => !isNaN(cellTime(r[ci]))));
    if (timeCol < 0) timeCol = names.findIndex((_, ci) => data.slice(0, 20).filter(r => !isNaN(cellTime(r[ci]))).length >= Math.min(5, data.length));
    let elapsedCol = -1, elapsedScale = 1;
    if (timeCol < 0) {
      elapsedCol = names.findIndex(n => TIME_HEADER.test(n));
      if (elapsedCol >= 0) {
        const n = names[elapsedCol];
        elapsedScale = /\bms\b|毫秒/i.test(n) ? 0.001 : /\bmin|分/i.test(n) ? 60 : /\bh(?:ou)?r|小時/i.test(n) ? 3600 : 1;
      }
    }

    const isIndexLike = ci => {
      if (INDEX_HEADER.test(names[ci])) return true;
      const v = data.slice(0, 30).map(r => cellNumber(r[ci], commaDecimal));
      return v.length >= 3 && v.every((x, i) => i === 0 || x - v[i - 1] === 1) && v.every(Number.isInteger);
    };
    const channels = [];
    for (let ci = 0; ci < width; ci++) {
      if (ci === timeCol || ci === elapsedCol) continue;
      if (SKIP_HEADER.test(names[ci])) continue;
      const nums = data.filter(r => !isNaN(cellNumber(r[ci], commaDecimal))).length;
      const errs = data.filter(r => ERROR_TOKEN.test(stripQuotes(r[ci]))).length;
      if (nums === 0 || (nums + errs) < data.length * 0.6) continue;
      if (isIndexLike(ci)) continue;
      channels.push({ col: ci, name: names[ci] || ('CH' + (channels.length + 1)), unit: unitOf(names[ci]) });
    }
    if (!channels.length) return { error: '找不到溫度通道欄位', channels: [], rows: [] };

    // Rows with a monotonic time axis (midnight roll-over without a date is unwrapped).
    let wrap = 0, prev = NaN;
    const rows = data.map(r => {
      let t = NaN;
      if (timeCol >= 0) {
        t = cellTime(r[timeCol]);
        if (!isNaN(t) && !isNaN(prev) && t + wrap < prev - 43200) wrap += 86400;
        if (!isNaN(t)) { t += wrap; prev = t; }
      } else if (elapsedCol >= 0) {
        t = cellNumber(r[elapsedCol], commaDecimal) * elapsedScale;
      }
      return { t, v: channels.map(ch => cellNumber(r[ch.col], commaDecimal)) };
    });
    const timed = rows.filter(r => !isNaN(r.t)).length;
    const timeMode = (timeCol >= 0 || elapsedCol >= 0) && timed >= rows.length * 0.8 ? 'time' : 'index';
    return {
      channels, rows, timeMode, delimiter: delim,
      timeHeader: timeCol >= 0 ? names[timeCol] : elapsedCol >= 0 ? names[elapsedCol] : '',
    };
  }

  /**
   * Last-window statistics per channel.
   * opts: { minutes (time mode, default 10), rowsN (index mode, default 30), stableRange (°C, default 1) }
   */
  function analyze(parsed, opts) {
    const o = Object.assign({ minutes: 10, rowsN: 30, stableRange: 1 }, opts || {});
    const rows = parsed.rows || [];
    let win = rows, info;
    if (parsed.timeMode === 'time') {
      const timed = rows.filter(r => !isNaN(r.t));
      const tEnd = Math.max(...timed.map(r => r.t));
      const tStart = Math.min(...timed.map(r => r.t));
      win = timed.filter(r => r.t >= tEnd - o.minutes * 60);
      info = { mode: 'time', minutes: o.minutes, rows: win.length, totalMinutes: (tEnd - tStart) / 60 };
    } else {
      win = rows.slice(-Math.max(1, o.rowsN));
      info = { mode: 'index', rows: win.length, totalRows: rows.length };
    }
    const stats = parsed.channels.map((ch, k) => {
      const pts = win.map(r => ({ t: r.t, v: r.v[k] })).filter(p => !isNaN(p.v));
      if (!pts.length) return { name: ch.name, n: 0, avg: NaN, min: NaN, max: NaN, range: NaN, last: NaN, slope: NaN, stable: false };
      const vals = pts.map(p => p.v);
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const min = Math.min(...vals), max = Math.max(...vals);
      let slope = NaN;   // °C per minute (least squares), time mode only
      if (info.mode === 'time' && pts.length >= 3) {
        const mt = pts.reduce((a, p) => a + p.t, 0) / pts.length;
        let num = 0, den = 0;
        pts.forEach(p => { num += (p.t - mt) * (p.v - avg); den += (p.t - mt) ** 2; });
        if (den > 0) slope = num / den * 60;
      }
      return { name: ch.name, n: vals.length, avg, min, max, range: max - min, last: vals[vals.length - 1], slope, stable: (max - min) <= o.stableRange };
    });
    return { info, stats };
  }

  // Token-aware name match: "PA-1" matches "101 PA-1 (C)" but not "PA-10".
  const loose = s => ' ' + String(s || '').toLowerCase().replace(/[([][^)\]]*[)\]]/g, ' ').replace(/[^a-z0-9㐀-鿿]+/g, ' ').trim() + ' ';
  const compact = s => String(s || '').toLowerCase().replace(/[^a-z0-9㐀-鿿]+/g, '');
  /** 0 = no match, 3 = same name, 2 = same after dropping channel prefix / unit, 1 = contained as whole tokens. */
  function nameScore(componentName, channelName) {
    const a = compact(componentName), b = compact(channelName);
    if (!a || !b) return 0;
    if (a === b) return 3;
    const stripped = compact(String(channelName).replace(/[([][^)\]]*[)\]]/g, '').replace(/^\s*(?:ch(?:annel)?\s*\d+|\d{3,4})\s*[:_\-.]?\s*/i, ''));
    if (stripped && stripped === a) return 2;
    return loose(channelName).includes(loose(componentName)) ? 1 : 0;
  }

  window.loggerCsv = { parse, analyze, nameScore, cellNumber, cellTime };
})();
