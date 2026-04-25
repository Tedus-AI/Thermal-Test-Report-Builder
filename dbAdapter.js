const DB_MODE = 'local';

const dbAdapter = {

  async init() {
    if (DB_MODE === 'local') return await fileDb.openFile();
    return { success: true };
  },

  async tryRestore() {
    if (DB_MODE === 'local') return await fileDb.tryRestore();
    return { success: true };
  },

  async reconnect() {
    if (DB_MODE === 'local') return await fileDb.reconnect();
    return { success: true };
  },

  isReady() {
    if (DB_MODE === 'local') return fileDb.isReady();
    return true;
  },

  getDbInfo() {
    if (DB_MODE === 'local') return `本機資料庫 ｜ ${fileDb.getFilename() ?? '未開啟'}`;
    return 'Firebase 雲端模式';
  },

  async getAllReports() {
    if (DB_MODE === 'local') return await fileDb.getAllReports();
    const snap = await window._getDocs(window._collection(window._db, 'thermal_reports'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  },

  async createReport(reportId, meta) {
    if (DB_MODE === 'local') return await fileDb.createReport(reportId, meta);
    await window._setDoc(window._doc(window._db, 'thermal_reports', reportId), meta);
  },

  async getReportMeta(reportId) {
    if (DB_MODE === 'local') return await fileDb.getReportMeta(reportId);
    const snap = await window._getDoc(window._doc(window._db, 'thermal_reports', reportId));
    return snap.exists() ? snap.data() : null;
  },

  async updateReportMeta(reportId, fields) {
    if (DB_MODE === 'local') return await fileDb.updateReportMeta(reportId, fields);
    await window._setDoc(
      window._doc(window._db, 'thermal_reports', reportId),
      fields, { merge: true }
    );
  },

  async deleteReport(reportId) {
    if (DB_MODE === 'local') return await fileDb.deleteReport(reportId);
    await window._deleteDoc(window._doc(window._db, 'thermal_reports', reportId));
  },

  async copyReport(sourceId, newId, newMeta) {
    if (DB_MODE === 'local') return await fileDb.copyReport(sourceId, newId, newMeta);
    const snap = await window._getDoc(window._doc(window._db, 'thermal_reports', sourceId));
    if (snap.exists()) {
      await window._setDoc(window._doc(window._db, 'thermal_reports', newId), { ...snap.data(), ...newMeta });
    }
  },

  async setPage(reportId, order, pageData) {
    if (DB_MODE === 'local') return await fileDb.setPage(reportId, order, pageData);
    await window._setDoc(
      window._doc(window._db, 'thermal_reports', reportId, 'pages', String(order)),
      pageData
    );
  },

  async getPage(reportId, order) {
    if (DB_MODE === 'local') return await fileDb.getPage(reportId, order);
    const snap = await window._getDoc(
      window._doc(window._db, 'thermal_reports', reportId, 'pages', String(order))
    );
    return snap.exists() ? snap.data() : null;
  },

  async getAllPages(reportId) {
    if (DB_MODE === 'local') return await fileDb.getAllPages(reportId);
    const snap = await window._getDocs(
      window._collection(window._db, 'thermal_reports', reportId, 'pages')
    );
    return snap.docs.map(d => d.data()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  },

  async deletePage(reportId, order) {
    if (DB_MODE === 'local') return await fileDb.deletePage(reportId, order);
    await window._deleteDoc(
      window._doc(window._db, 'thermal_reports', reportId, 'pages', String(order))
    );
  },

  async getTimLibrary() {
    if (DB_MODE === 'local') return await fileDb.getTimLibrary();
    const snap = await window._getDoc(window._doc(window._db, 'app_data', 'tim_library'));
    return snap.exists() ? snap.data() : { grease: [], pad: [], putty: [] };
  },

  async setTimLibrary(data) {
    if (DB_MODE === 'local') return await fileDb.setTimLibrary(data);
    await window._setDoc(window._doc(window._db, 'app_data', 'tim_library'), data);
  },

  async pickFile() {
    if (DB_MODE === 'local') return await fileDb.pickFile();
  },

  exportBackup() {
    if (DB_MODE === 'local') fileDb.exportBackup();
    else alert('Firebase 模式請至 Firebase Console 備份');
  }
};

window.dbAdapter = dbAdapter;
