// Wrapped in an IIFE so internal helpers don't leak into the page's global scope
// (index.html is one big classic script; a clashing top-level name would break it).
(() => {
let fileHandle = null;
let dbCache = {};

// Concurrency / integrity guards for the single JSON database file.
// knownLastModified: the file's lastModified right after our own last read or
// write. If the file on disk changes behind our back (another tab, another
// engineer on a shared drive, a sync client) we refuse to overwrite it.
let knownLastModified = null;
let conflict = false;
// Write queue: at most one write in flight plus one queued. Every mutation
// calls _writeFile(); calls made while a write is already queued share it, so
// a burst of saves collapses into a single serialized write of the latest state.
let _pendingWrite = null;
let _writeTail = Promise.resolve();

// ── Auto-backup folder (a directory handle chosen once, persisted like the DB) ──
let backupDirHandle = null;
const BACKUP_PREFIX = 'thermal_reports_backup_';
const BACKUP_KEEP = 30;         // keep the newest N backup files, prune older

// Local (not UTC) calendar date / time — backups and defaults follow the
// engineer's clock, so a 07:00 save in Taiwan is not filed under yesterday.
function localDateStr(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function localTimeStamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Pure helper (unit-testable): given backup filenames, return the ones to delete
// so only the newest `keep` remain. Names are YYYY-MM-DD[_HHMMSS] so
// lexicographic order == time order.
function backupsToPrune(names, keep) {
  const b = names.filter(n => n.startsWith(BACKUP_PREFIX) && n.endsWith('.json')).sort();
  return b.length > keep ? b.slice(0, b.length - keep) : [];
}

function dbError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// Callers get copies, never live references into the cache, so editor state
// and the persisted snapshot can't silently alias each other.
function clone(v) {
  return v === undefined || v === null ? v : structuredClone(v);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ── SharePoint sync bookkeeping, persisted inside the local database file ──
// dbCache.sp_sync = {
//   dirty:   { [reportId]: seq }   reports changed locally and not yet on SharePoint
//   deleted: [reportId]            reports deleted locally that still exist on SharePoint
//   etags:   { [reportId]: eTag }  SharePoint version each report was last synced with
//   tim_dirty: seq, tim_etag: eTag the shared TIM library, same idea
// }
// Every local mutation marks what changed, so the sync engine (spSync.js) can push
// exactly those reports — even after a reload or a period offline.
let dbGeneration = 0;            // bumps whenever a different database (or disk state) is loaded
const writeListeners = new Set();
function syncMeta() {
  if (!isPlainObject(dbCache.sp_sync)) dbCache.sp_sync = {};
  const m = dbCache.sp_sync;
  if (!isPlainObject(m.dirty)) m.dirty = {};
  if (!Array.isArray(m.deleted)) m.deleted = [];
  if (!isPlainObject(m.etags)) m.etags = {};
  if (typeof m.tim_dirty !== 'number') m.tim_dirty = 0;
  if (m.tim_etag === undefined) m.tim_etag = null;
  return m;
}
function markDirty(id) {
  const m = syncMeta();
  m.dirty[id] = (m.dirty[id] || 0) + 1;
  m.deleted = m.deleted.filter(x => x !== id);
}
function markDeleted(id) {
  const m = syncMeta();
  delete m.dirty[id];
  if (m.etags[id] && !m.deleted.includes(id)) m.deleted.push(id);
}
function markTimDirty() {
  const m = syncMeta();
  m.tim_dirty = (m.tim_dirty || 0) + 1;
}

// Parse + validate a database file's text. Throws DB_PARSE instead of ever
// substituting an empty database (which the next save would write over the
// real file). A brand-new empty file is accepted as an empty database.
function parseDbText(text) {
  if (text.trim() === '') return { thermal_reports: {} };
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw dbError('DB_PARSE', '資料庫檔案不是有效的 JSON（可能已毀損或被截斷）'); }
  if (!isPlainObject(data)) throw dbError('DB_PARSE', '檔案內容不是報告資料庫格式');
  if (data.thermal_reports === undefined) data.thermal_reports = {};
  if (!isPlainObject(data.thermal_reports)) throw dbError('DB_PARSE', '檔案內容不是報告資料庫格式（thermal_reports 欄位錯誤）');
  return data;
}

const fileDb = {

  // Silent restore: tries to reuse a previously granted handle without prompting.
  // Safe to call on page load (no user gesture). Returns
  //   { success: true, filename, otherTab }     when permission already granted
  //   { success: false, needsPermission: true, filename }  when user needs to click to re-grant
  //   { success: false, reason: 'no-saved' }    when nothing was saved before
  //   { success: false, reason: 'parse-error', filename, message } when the file is unreadable
  async tryRestore() {
    const savedHandle = await this._loadSavedHandle();
    if (!savedHandle) return { success: false, reason: 'no-saved' };
    let state;
    try { state = await savedHandle.queryPermission({ mode: 'readwrite' }); }
    catch (e) { return { success: false, reason: 'error' }; }
    if (state !== 'granted') return { success: false, needsPermission: true, filename: savedHandle.name };
    return await this._open(savedHandle);
  },

  // Called from a user gesture (button click) to re-grant permission on the saved handle.
  async reconnect() {
    const savedHandle = await this._loadSavedHandle();
    if (!savedHandle) return await this.pickFile();
    try {
      const permission = await savedHandle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') return { success: false, reason: 'denied' };
    } catch (e) {
      return { success: false, reason: 'error' };
    }
    return await this._open(savedHandle);
  },

  async openFile() {
    const restored = await this.tryRestore();
    if (restored.success || restored.needsPermission || restored.reason === 'parse-error') return restored;
    return await this.pickFile();
  },

  async pickFile() {
    let handle;
    try {
      const opts = {
        types: [{ description: 'JSON Database', accept: { 'application/json': ['.json'] } }],
        multiple: false
      };
      if (fileHandle) opts.startIn = fileHandle;
      [handle] = await window.showOpenFilePicker(opts);
    } catch (e) {
      if (e.name === 'AbortError') return { success: false, reason: 'cancelled' };
      throw e;
    }
    await this.flush();
    const r = await this._open(handle);
    if (r.success) await this._saveHandle(handle);
    return r;
  },

  // Create a brand-new, empty database file (user gesture).
  async createFile() {
    let handle;
    try {
      const opts = {
        suggestedName: 'thermal_reports_db.json',
        types: [{ description: 'JSON Database', accept: { 'application/json': ['.json'] } }]
      };
      if (fileHandle) opts.startIn = fileHandle;
      handle = await window.showSaveFilePicker(opts);
    } catch (e) {
      if (e.name === 'AbortError') return { success: false, reason: 'cancelled' };
      throw e;
    }
    await this.flush();
    fileHandle = handle;
    dbCache = { thermal_reports: {} };
    knownLastModified = null;
    conflict = false;
    dbGeneration++;
    await this._writeFile();
    await this._saveHandle(handle);
    const otherTab = !(await this._acquireTabLock(handle.name));
    return { success: true, filename: handle.name, isNew: true, otherTab };
  },

  isReady() { return fileHandle !== null; },
  getFilename() { return fileHandle ? fileHandle.name : null; },
  hasConflict() { return conflict; },

  // Resolves once every queued write has settled (never rejects).
  flush() { return _writeTail; },

  // Conflict resolution: discard this window's in-memory state and re-read disk…
  async reloadFromDisk() {
    this._assertReady();
    await this.flush();
    const file = await fileHandle.getFile();
    dbCache = parseDbText(await file.text());
    knownLastModified = file.lastModified;
    conflict = false;
    dbGeneration++;
  },
  // …or overwrite the file with this window's state (explicit user choice).
  async forceOverwrite() {
    this._assertReady();
    conflict = false;
    knownLastModified = null;
    await this._writeFile();
  },

  async getAllReports() {
    this._assertReady();
    const reports = dbCache['thermal_reports'] ?? {};
    return Object.entries(reports).map(([id, data]) => ({
      id,
      project_name: data.project_name,
      model: data.model,
      stage: data.stage,
      date: data.date,
      created_at: data.created_at,
      updated_at: data.updated_at
    })).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  },

  async createReport(reportId, meta) {
    this._assertReady();
    if (!dbCache['thermal_reports']) dbCache['thermal_reports'] = {};
    dbCache['thermal_reports'][reportId] = { ...clone(meta), pages: {} };
    markDirty(reportId);
    await this._writeFile();
  },

  async getReportMeta(reportId) {
    this._assertReady();
    const report = dbCache['thermal_reports']?.[reportId];
    if (!report) return null;
    const { pages, ...meta } = report;
    return clone(meta);
  },

  async updateReportMeta(reportId, fields) {
    this._assertReady();
    const report = this._requireReport(reportId);
    const { pages: _ignored, ...rest } = fields || {};
    Object.assign(report, clone(rest));
    markDirty(reportId);
    await this._writeFile();
  },

  async deleteReport(reportId) {
    this._assertReady();
    if (dbCache['thermal_reports']?.[reportId]) {
      delete dbCache['thermal_reports'][reportId];
      markDeleted(reportId);
      await this._writeFile();
    }
  },

  async copyReport(sourceId, newId, newMeta) {
    this._assertReady();
    const source = this._requireReport(sourceId);
    dbCache['thermal_reports'][newId] = {
      ...clone(source),
      ...clone(newMeta),
    };
    markDirty(newId);
    await this._writeFile();
  },

  async setPage(reportId, order, pageData) {
    this._assertReady();
    const report = this._requireReport(reportId);
    if (!report.pages) report.pages = {};
    report.pages[String(order)] = clone(pageData);
    markDirty(reportId);
    await this._writeFile();
  },

  // Replace a report's whole page list in one atomic write (used for reorder,
  // delete, duplicate and gap healing) so slots never end up half-shifted.
  async setAllPages(reportId, pagesArray) {
    this._assertReady();
    const report = this._requireReport(reportId);
    const pages = {};
    pagesArray.forEach((p, i) => { pages[String(i)] = { ...clone(p), order: i }; });
    report.pages = pages;
    markDirty(reportId);
    await this._writeFile();
  },

  async getPage(reportId, order) {
    this._assertReady();
    return clone(dbCache['thermal_reports']?.[reportId]?.pages?.[String(order)] ?? null);
  },

  async getAllPages(reportId) {
    this._assertReady();
    const pages = dbCache['thermal_reports']?.[reportId]?.pages ?? {};
    return Object.entries(pages)
      .sort((a, b) => ((a[1].order ?? +a[0]) - (b[1].order ?? +b[0])) || (+a[0] - +b[0]))
      .map(([, p]) => clone(p));
  },

  async deletePage(reportId, order) {
    this._assertReady();
    if (dbCache['thermal_reports']?.[reportId]?.pages) {
      delete dbCache['thermal_reports'][reportId].pages[String(order)];
      markDirty(reportId);
      await this._writeFile();
    }
  },

  async getTimLibrary() {
    this._assertReady();
    return clone(dbCache['tim_library']) || { grease: [], pad: [], putty: [] };
  },

  async setTimLibrary(data) {
    this._assertReady();
    dbCache['tim_library'] = clone(data);
    markTimDirty();
    await this._writeFile();
  },

  async exportBackup() {
    const suggestedName = `${BACKUP_PREFIX}${localDateStr()}.json`;
    const json = JSON.stringify(dbCache);
    if (window.showSaveFilePicker) {
      try {
        const opts = {
          suggestedName,
          types: [{ description: 'JSON Backup', accept: { 'application/json': ['.json'] } }]
        };
        if (fileHandle) opts.startIn = fileHandle;
        const saveHandle = await window.showSaveFilePicker(opts);
        const writable = await saveHandle.createWritable();
        await writable.write(json);
        await writable.close();
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  },

  // ── Auto-backup folder ──────────────────────────────────────────────
  hasBackupDir() { return backupDirHandle !== null; },
  getBackupDirName() { return backupDirHandle ? backupDirHandle.name : null; },

  // Pick a folder (user gesture) to hold automatic daily backups; persist the handle.
  async pickBackupDir() {
    try {
      const opts = { mode: 'readwrite' };
      if (fileHandle) opts.startIn = fileHandle;
      const handle = await window.showDirectoryPicker(opts);
      backupDirHandle = handle;
      await this._saveBackupDirHandle(handle);
      return { success: true, name: handle.name };
    } catch (e) {
      if (e.name === 'AbortError') return { success: false, reason: 'cancelled' };
      return { success: false, reason: 'error' };
    }
  },

  // Silent restore on load (no prompt). granted → ready; otherwise needsPermission.
  async tryRestoreBackupDir() {
    const h = await this._loadBackupDirHandle();
    if (!h) return { success: false, reason: 'no-saved' };
    try {
      const state = await h.queryPermission({ mode: 'readwrite' });
      if (state === 'granted') { backupDirHandle = h; return { success: true, name: h.name }; }
      return { success: false, needsPermission: true, name: h.name };
    } catch { return { success: false, reason: 'error' }; }
  },

  // Re-grant permission on the saved folder from a user gesture.
  async reconnectBackupDir() {
    const h = await this._loadBackupDirHandle();
    if (!h) return await this.pickBackupDir();
    try {
      const perm = await h.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') { backupDirHandle = h; return { success: true, name: h.name }; }
      return { success: false, reason: 'denied' };
    } catch { return { success: false, reason: 'error' }; }
  },

  // Write today's backup into the folder (overwrite same-day), then prune old ones.
  // Shrink guard: if today's existing backup is more than twice the size of the
  // new snapshot, it is kept and the new one goes to a timestamped file instead,
  // so a damaged/emptied database can never wipe out the day's good backup.
  async writeAutoBackup() {
    if (!backupDirHandle) return { success: false, reason: 'no-dir' };
    if (!fileHandle) return { success: false, reason: 'no-db' };
    try {
      const state = await backupDirHandle.queryPermission({ mode: 'readwrite' });
      if (state !== 'granted') return { success: false, needsPermission: true };
      const blob = new Blob([JSON.stringify(dbCache)], { type: 'application/json' });
      const date = localDateStr();
      let name = `${BACKUP_PREFIX}${date}.json`;
      try {
        const existing = await (await backupDirHandle.getFileHandle(name)).getFile();
        if (existing.size > 1024 && existing.size > blob.size * 2) {
          name = `${BACKUP_PREFIX}${date}_${localTimeStamp()}.json`;
        }
      } catch { /* no backup yet today */ }
      const fh = await backupDirHandle.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      await this._pruneBackups();
      return { success: true, name };
    } catch (e) {
      return { success: false, reason: 'error', error: String(e) };
    }
  },

  async _pruneBackups() {
    try {
      const names = [];
      for await (const [n, h] of backupDirHandle.entries()) {
        if (h.kind === 'file') names.push(n);
      }
      for (const n of backupsToPrune(names, BACKUP_KEEP)) {
        try { await backupDirHandle.removeEntry(n); } catch {}
      }
    } catch {}
  },

  async _saveBackupDirHandle(handle) {
    try {
      const idb = await this._openIdb();
      const tx = idb.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'thermal_reports_backup_dir');
    } catch (e) {}
  },
  async _loadBackupDirHandle() {
    try {
      const idb = await this._openIdb();
      return await new Promise((resolve) => {
        const tx = idb.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('thermal_reports_backup_dir');
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  },

  // Called after every successful write of the local database file.
  onWrite(fn) { writeListeners.add(fn); return () => writeListeners.delete(fn); },

  // ── API for the SharePoint sync engine (spSync.js). Changes made here are
  // sync results, so they never mark anything dirty themselves. ──
  sync: {
    generation() { return dbGeneration; },
    state() { return clone(syncMeta()); },
    hasPending() {
      if (!fileHandle) return false;
      const m = syncMeta();
      return Object.keys(m.dirty).length > 0 || m.deleted.length > 0 || m.tim_dirty > 0;
    },
    pendingCount() {
      const m = syncMeta();
      return Object.keys(m.dirty).length + m.deleted.length + (m.tim_dirty ? 1 : 0);
    },
    reportIds() { return Object.keys(dbCache.thermal_reports || {}); },
    getReport(id) { return clone(dbCache.thermal_reports?.[id] ?? null); },
    getTim() { return clone(dbCache.tim_library) || { grease: [], pad: [], putty: [] }; },
    // Take SharePoint's version of a report (it was not changed locally).
    applyRemote(id, report, etag) {
      if (!dbCache.thermal_reports) dbCache.thermal_reports = {};
      dbCache.thermal_reports[id] = clone(report);
      const m = syncMeta();
      m.etags[id] = etag;
      delete m.dirty[id];
      m.deleted = m.deleted.filter(x => x !== id);
    },
    // A report deleted on SharePoint by someone else.
    removeLocal(id) {
      if (dbCache.thermal_reports) delete dbCache.thermal_reports[id];
      const m = syncMeta();
      delete m.etags[id];
      delete m.dirty[id];
      m.deleted = m.deleted.filter(x => x !== id);
    },
    // A new local report created by the sync itself (conflict copy); pushed next.
    addReport(id, report) {
      if (!dbCache.thermal_reports) dbCache.thermal_reports = {};
      dbCache.thermal_reports[id] = clone(report);
      markDirty(id);
    },
    markDirty(id) { markDirty(id); },
    markTimDirty() { markTimDirty(); },
    // Replace the TIM library with a merged version (keeps its dirty state).
    setTim(lib) { dbCache.tim_library = clone(lib); },
    setEtag(id, etag) { syncMeta().etags[id] = etag; },
    markPushed(id, etag, seq) {
      const m = syncMeta();
      m.etags[id] = etag;
      if (m.dirty[id] === seq) delete m.dirty[id];   // edited again meanwhile → stays dirty
    },
    markDeletePushed(id) {
      const m = syncMeta();
      m.deleted = m.deleted.filter(x => x !== id);
      delete m.etags[id];
    },
    applyRemoteTim(lib, etag) {
      dbCache.tim_library = clone(lib);
      const m = syncMeta();
      m.tim_etag = etag;
      m.tim_dirty = 0;
    },
    markTimPushed(etag, seq) {
      const m = syncMeta();
      m.tim_etag = etag;
      if (m.tim_dirty === seq) m.tim_dirty = 0;
    },
    // Full database without the sync bookkeeping (SharePoint daily backup).
    backupText() {
      const { sp_sync, ...rest } = dbCache;
      return JSON.stringify(rest);
    },
    persist() { return fileDb._writeFile(); },
  },

  // Test seams: inject fake handles (used only by headless verification).
  __setBackupDirForTest(h) { backupDirHandle = h; },
  __setFileHandleForTest(h) { fileHandle = h; knownLastModified = null; conflict = false; dbGeneration++; },
  __setDbCacheForTest(c) { dbCache = c; dbGeneration++; },
  __backupsToPrune: backupsToPrune,
  __parseDbText: parseDbText,

  // Open a handle: read + validate first, and only then make it the active DB.
  // A file that fails to parse is never adopted, so it can't be overwritten.
  async _open(handle) {
    let data, lastModified;
    try {
      const file = await handle.getFile();
      data = parseDbText(await file.text());
      lastModified = file.lastModified;
    } catch (e) {
      if (e.code === 'DB_PARSE') return { success: false, reason: 'parse-error', filename: handle.name, message: e.message };
      return { success: false, reason: 'error', filename: handle.name, message: String(e) };
    }
    fileHandle = handle;
    dbCache = data;
    knownLastModified = lastModified;
    conflict = false;
    dbGeneration++;
    const otherTab = !(await this._acquireTabLock(handle.name));
    return { success: true, filename: handle.name, otherTab };
  },

  // Best-effort "is this DB open in another tab?" check via the Web Locks API.
  // The lastModified conflict check is the real guard; this only lets the UI
  // warn up front. Returns false when another tab already holds the lock.
  async _acquireTabLock(name) {
    if (!navigator.locks) return true;
    if (this._lockName === name && this._releaseLock) return true;   // re-opening the same DB in this tab
    if (this._releaseLock) { this._releaseLock(); this._releaseLock = null; this._lockName = null; }
    return await new Promise((resolve) => {
      navigator.locks.request('thermal-report-db:' + name, { ifAvailable: true }, (lock) => {
        if (!lock) { resolve(false); return null; }
        this._lockName = name;
        resolve(true);
        return new Promise(release => { this._releaseLock = release; });
      }).catch(() => resolve(true));
    });
  },

  _requireReport(reportId) {
    const report = dbCache['thermal_reports']?.[reportId];
    if (!report) throw dbError('DB_NO_REPORT', '目前開啟的資料庫中找不到這份報告（可能已切換資料庫或報告已被刪除）');
    return report;
  },

  _writeFile() {
    if (_pendingWrite) return _pendingWrite;
    const p = _writeTail.then(() => { _pendingWrite = null; return this._doWrite(); });
    _pendingWrite = p;
    _writeTail = p.catch(() => {});
    return p;
  },

  async _doWrite() {
    if (!fileHandle) throw dbError('DB_NOT_READY', '[fileDb] 尚未開啟資料庫');
    if (conflict) throw dbError('DB_CONFLICT', '資料庫檔案已被其他視窗或使用者修改，已停止儲存以免覆蓋');
    const handle = fileHandle;
    if (knownLastModified !== null) {
      const current = await handle.getFile();
      if (current.lastModified !== knownLastModified) {
        conflict = true;
        throw dbError('DB_CONFLICT', '資料庫檔案已被其他視窗或使用者修改，已停止儲存以免覆蓋');
      }
    }
    const json = JSON.stringify(dbCache);
    const writable = await handle.createWritable();
    try {
      await writable.write(json);
      await writable.close();
    } catch (e) {
      try { await writable.abort(); } catch {}
      throw e;
    }
    knownLastModified = (await handle.getFile()).lastModified;
    writeListeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  },

  _assertReady() {
    if (!fileHandle) throw dbError('DB_NOT_READY', '[fileDb] 尚未開啟資料庫');
  },

  async _saveHandle(handle) {
    try {
      const idb = await this._openIdb();
      const tx = idb.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, 'thermal_reports_db');
    } catch(e) {}
  },

  async _loadSavedHandle() {
    try {
      const idb = await this._openIdb();
      return await new Promise((resolve) => {
        const tx = idb.transaction('handles', 'readonly');
        const req = tx.objectStore('handles').get('thermal_reports_db');
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  },

  async _openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('fileDbMeta_thermalReport', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = reject;
    });
  }
};

window.fileDb = fileDb;
window.localDateStr = localDateStr;
})();
