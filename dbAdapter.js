// Storage adapter. The app currently runs in local-file mode only (fileDb.js:
// one JSON database file chosen via the File System Access API). The former
// Firebase branch was removed because its SDK is no longer loaded; keep this
// interface stable so another backend can be plugged in later.
const dbAdapter = {

  init() { return fileDb.openFile(); },
  tryRestore() { return fileDb.tryRestore(); },
  reconnect() { return fileDb.reconnect(); },
  pickFile() { return fileDb.pickFile(); },
  createFile() { return fileDb.createFile(); },

  isReady() { return fileDb.isReady(); },
  getDbInfo() { return `本機資料庫 ｜ ${fileDb.getFilename() ?? '未開啟'}`; },

  // Write-safety: wait for queued writes; detect / resolve external changes.
  flush() { return fileDb.flush(); },
  hasConflict() { return fileDb.hasConflict(); },
  hasUnsavedChanges() { return fileDb.hasUnsavedChanges(); },
  reloadFromDisk() { return fileDb.reloadFromDisk(); },
  forceOverwrite() { return fileDb.forceOverwrite(); },

  getAllReports() { return fileDb.getAllReports(); },
  getReportDigests() { return fileDb.getReportDigests(); },
  createReport(reportId, meta) { return fileDb.createReport(reportId, meta); },
  getReportMeta(reportId) { return fileDb.getReportMeta(reportId); },
  updateReportMeta(reportId, fields) { return fileDb.updateReportMeta(reportId, fields); },
  deleteReport(reportId) { return fileDb.deleteReport(reportId); },
  copyReport(sourceId, newId, newMeta) { return fileDb.copyReport(sourceId, newId, newMeta); },

  setPage(reportId, order, pageData) { return fileDb.setPage(reportId, order, pageData); },
  setAllPages(reportId, pages) { return fileDb.setAllPages(reportId, pages); },
  getPage(reportId, order) { return fileDb.getPage(reportId, order); },
  getAllPages(reportId) { return fileDb.getAllPages(reportId); },
  deletePage(reportId, order) { return fileDb.deletePage(reportId, order); },

  getTimLibrary() { return fileDb.getTimLibrary(); },
  setTimLibrary(data) { return fileDb.setTimLibrary(data); },

  exportBackup() { return fileDb.exportBackup(); },

  // ── Auto-backup folder passthroughs ──
  hasBackupDir() { return fileDb.hasBackupDir(); },
  getBackupDirName() { return fileDb.getBackupDirName(); },
  pickBackupDir() { return fileDb.pickBackupDir(); },
  tryRestoreBackupDir() { return fileDb.tryRestoreBackupDir(); },
  reconnectBackupDir() { return fileDb.reconnectBackupDir(); },
  writeAutoBackup() { return fileDb.writeAutoBackup(); }
};

window.dbAdapter = dbAdapter;
