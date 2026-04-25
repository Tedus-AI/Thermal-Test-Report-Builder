let fileHandle = null;
let dbCache = {};

const fileDb = {

  // Silent restore: tries to reuse a previously granted handle without prompting.
  // Safe to call on page load (no user gesture). Returns
  //   { success: true, filename }               when permission already granted
  //   { success: false, needsPermission: true, filename }  when user needs to click to re-grant
  //   { success: false, reason: 'no-saved' }    when nothing was saved before
  async tryRestore() {
    const savedHandle = await this._loadSavedHandle();
    if (!savedHandle) return { success: false, reason: 'no-saved' };
    try {
      const state = await savedHandle.queryPermission({ mode: 'readwrite' });
      if (state === 'granted') {
        fileHandle = savedHandle;
        await this._readFile();
        return { success: true, filename: fileHandle.name };
      }
      return { success: false, needsPermission: true, filename: savedHandle.name };
    } catch (e) {
      return { success: false, reason: 'error' };
    }
  },

  // Called from a user gesture (button click) to re-grant permission on the saved handle.
  async reconnect() {
    const savedHandle = await this._loadSavedHandle();
    if (!savedHandle) return await this.pickFile();
    try {
      const permission = await savedHandle.requestPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        fileHandle = savedHandle;
        await this._readFile();
        return { success: true, filename: fileHandle.name };
      }
      return { success: false, reason: 'denied' };
    } catch (e) {
      return { success: false, reason: 'error' };
    }
  },

  async openFile() {
    const restored = await this.tryRestore();
    if (restored.success) return restored;
    if (restored.needsPermission) {
      // caller on page load cannot prompt; let UI show a click-to-restore button
      return restored;
    }
    return await this.pickFile();
  },

  async pickFile() {
    try {
      [fileHandle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON Database', accept: { 'application/json': ['.json'] } }],
        multiple: false
      });
      await this._readFile();
      await this._saveHandle(fileHandle);
      return { success: true, filename: fileHandle.name };
    } catch(e) {
      if (e.name === 'AbortError') return { success: false, reason: 'cancelled' };
      throw e;
    }
  },

  async createFile() {
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: 'thermal_reports_db.json',
        types: [{ description: 'JSON Database', accept: { 'application/json': ['.json'] } }]
      });
      dbCache = { thermal_reports: {} };
      await this._writeFile();
      await this._saveHandle(fileHandle);
      return { success: true, filename: fileHandle.name, isNew: true };
    } catch(e) {
      if (e.name === 'AbortError') return { success: false, reason: 'cancelled' };
      throw e;
    }
  },

  isReady() { return fileHandle !== null; },
  getFilename() { return fileHandle ? fileHandle.name : null; },

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
    dbCache['thermal_reports'][reportId] = { ...meta, pages: {} };
    await this._writeFile();
  },

  async getReportMeta(reportId) {
    this._assertReady();
    const report = dbCache['thermal_reports']?.[reportId];
    if (!report) return null;
    const { pages, ...meta } = report;
    return meta;
  },

  async updateReportMeta(reportId, fields) {
    this._assertReady();
    if (!dbCache['thermal_reports']?.[reportId]) return;
    const pages = dbCache['thermal_reports'][reportId].pages ?? {};
    dbCache['thermal_reports'][reportId] = {
      ...dbCache['thermal_reports'][reportId],
      ...fields,
      pages
    };
    await this._writeFile();
  },

  async deleteReport(reportId) {
    this._assertReady();
    if (dbCache['thermal_reports']) {
      delete dbCache['thermal_reports'][reportId];
      await this._writeFile();
    }
  },

  async copyReport(sourceId, newId, newMeta) {
    this._assertReady();
    const source = dbCache['thermal_reports']?.[sourceId];
    if (!source) return;
    dbCache['thermal_reports'][newId] = {
      ...source,
      ...newMeta,
      pages: JSON.parse(JSON.stringify(source.pages ?? {}))
    };
    await this._writeFile();
  },

  async setPage(reportId, order, pageData) {
    this._assertReady();
    if (!dbCache['thermal_reports']?.[reportId]) return;
    if (!dbCache['thermal_reports'][reportId].pages) {
      dbCache['thermal_reports'][reportId].pages = {};
    }
    dbCache['thermal_reports'][reportId].pages[String(order)] = pageData;
    await this._writeFile();
  },

  async getPage(reportId, order) {
    this._assertReady();
    return dbCache['thermal_reports']?.[reportId]?.pages?.[String(order)] ?? null;
  },

  async getAllPages(reportId) {
    this._assertReady();
    const pages = dbCache['thermal_reports']?.[reportId]?.pages ?? {};
    return Object.values(pages).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  },

  async deletePage(reportId, order) {
    this._assertReady();
    if (dbCache['thermal_reports']?.[reportId]?.pages) {
      delete dbCache['thermal_reports'][reportId].pages[String(order)];
      await this._writeFile();
    }
  },

  async getTimLibrary() {
    this._assertReady();
    return dbCache['tim_library'] || { grease: [], pad: [], putty: [] };
  },

  async setTimLibrary(data) {
    this._assertReady();
    dbCache['tim_library'] = data;
    await this._writeFile();
  },

  exportBackup() {
    const blob = new Blob([JSON.stringify(dbCache, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `thermal_reports_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  async _readFile() {
    const file = await fileHandle.getFile();
    const text = await file.text();
    try { dbCache = JSON.parse(text); }
    catch { dbCache = { thermal_reports: {} }; }
  },

  async _writeFile() {
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(dbCache, null, 2));
    await writable.close();
  },

  _assertReady() {
    if (!fileHandle) throw new Error('[fileDb] 尚未開啟資料庫');
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
