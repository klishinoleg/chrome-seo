/* Private extension-origin immutable competitor reports and resumable page chunks. */
(function (root) {
  'use strict';
  let connection;
  const ERRORS = Object.freeze({ REPORT_DELETED: 'REPORT_DELETED' });
  const fail = message => { throw new Error(message); };
  const clone = value => JSON.parse(JSON.stringify(value));
  function text(value, max = 500, required = false) {
    if (typeof value !== 'string' || value.length > max || required && !value.trim()) fail('Invalid competitor report data');
    return value;
  }
  function database() {
    if (!connection) connection = new Promise((resolve, reject) => {
      const request = indexedDB.open('seoCompetitors', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('reports', { keyPath: 'id' });
        db.createObjectStore('drafts', { keyPath: 'id' }).createIndex('runId', 'runId');
      };
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = null; }; resolve(request.result); };
      request.onerror = () => reject(new Error('Cannot open competitor reports'));
      request.onblocked = () => reject(new Error('Competitor reports database is busy'));
    }).catch(error => { connection = null; throw error; });
    return connection;
  }
  async function transaction(storeName, mode, operation) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      let result;
      try { operation(tx.objectStore(storeName), value => { result = value; }); } catch (error) { tx.abort(); reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(new Error('Cannot persist competitor report'));
    });
  }
  function rows(value) {
    if (!Array.isArray(value) || value.length > 2000) fail('Invalid competitor report rows');
    return value.map(row => {
      if (!row || typeof row !== 'object' || !Number.isInteger(row.position) || row.position < 1 || row.position > 100 || !Number.isInteger(row.page) || row.page < 1 || !Number.isInteger(row.positionOnPage) || row.positionOnPage < 1 || row.positionOnPage > 100) fail('Invalid competitor row position');
      const result = { query: text(row.query, 500, true), position: row.position, page: row.page, positionOnPage: row.positionOnPage, url: text(row.url, 8192, true), hostname: text(row.hostname, 253, true), serpUrl: text(row.serpUrl, 8192, true) };
      for (const field of ['url', 'serpUrl']) { let url; try { url = new URL(result[field]); } catch { fail('Invalid competitor row URL'); } if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('Invalid competitor row URL'); }
      if (row.title !== undefined) result.title = text(row.title, 1000);
      return result;
    });
  }
  async function appendDraft(chunk) {
    const value = { id: text(chunk.id, 200, true), runId: text(chunk.runId, 200, true), queryIndex: chunk.queryIndex, pageIndex: chunk.pageIndex, rows: rows(chunk.rows) };
    if (!Number.isInteger(value.queryIndex) || value.queryIndex < 0 || value.queryIndex >= 20 || !Number.isInteger(value.pageIndex) || value.pageIndex < 1 || value.pageIndex > 10 || value.rows.length > 100) fail('Invalid competitor page chunk');
    return transaction('drafts', 'readwrite', (store, done) => {
      const request = store.get(value.id);
      request.onsuccess = () => { if (!request.result) store.add(value); done(request.result || value); };
    });
  }
  async function readDraft(runId) {
    text(runId, 200, true);
    const chunks = await transaction('drafts', 'readonly', (store, done) => { const request = store.index('runId').getAll(runId); request.onsuccess = () => done(request.result); });
    return chunks.sort((a, b) => a.queryIndex - b.queryIndex || a.pageIndex - b.pageIndex).flatMap(chunk => chunk.rows);
  }
  async function saveReport(report) {
    if (!report || !['google', 'yandex'].includes(report.engine) || ![30, 100].includes(report.limit) || !['completed', 'partial', 'stopped'].includes(report.status) || !Array.isArray(report.queries) || !report.queries.length || report.queries.length > 20 || !Array.isArray(report.queryResults) || report.queryResults.length !== report.queries.length) fail('Invalid competitor report');
    const value = { id: text(report.id, 200, true), createdAt: text(report.createdAt, 40, true), engine: report.engine, limit: report.limit, queries: report.queries.map(query => text(query, 500, true)), queryResults: clone(report.queryResults), rows: rows(report.rows), status: report.status };
    if (!Number.isFinite(Date.parse(value.createdAt))) fail('Invalid report creation date');
    const saved = await transaction('reports', 'readwrite', (store, done) => {
      const request = store.get(value.id);
      request.onsuccess = () => { if (!request.result) store.add(value); done(request.result || value); };
    });
    if (saved.deleted) throw Object.assign(new Error('Competitor report was deleted'), { code: ERRORS.REPORT_DELETED });
    return saved;
  }
  async function deleteReport(id) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['reports', 'drafts'], 'readwrite');
      let missing = false;
      const reports = tx.objectStore('reports');
      const request = reports.get(id);
      request.onsuccess = () => {
        if (!request.result || request.result.deleted) { missing = true; tx.abort(); return; }
        // Keep only an id marker so interrupted finalization cannot restore the report.
        reports.put({ id, deleted: true });
        const cursor = tx.objectStore('drafts').index('runId').openCursor(id);
        cursor.onsuccess = () => {
          const chunk = cursor.result;
          if (chunk) { chunk.delete(); chunk.continue(); }
        };
      };
      tx.oncomplete = () => resolve({ deleted: true, reportId: id });
      tx.onerror = tx.onabort = () => reject(new Error(missing ? 'Competitor report not found' : 'Cannot delete competitor report'));
    });
  }
  const trusted = sender => Boolean(sender && sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL('')) && (!sender.tab || typeof sender.tab.url === 'string' && sender.tab.url.startsWith(chrome.runtime.getURL(''))));
  async function dispatch(message, sender) {
    if (!trusted(sender)) fail('Competitor reports are available only to extension pages');
    if (message.action === 'list') {
      const reports = await transaction('reports', 'readonly', (store, done) => { const request = store.getAll(); request.onsuccess = () => done(request.result); });
      return { reports: reports.filter(report => !report.deleted).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ rows: storedRows, ...metadata }) => ({ ...metadata, rowCount: storedRows.length })) };
    }
    if (message.action === 'get') {
      const id = text(message.reportId, 200, true);
      const report = await transaction('reports', 'readonly', (store, done) => { const request = store.get(id); request.onsuccess = () => done(request.result); });
      if (!report || report.deleted) fail('Competitor report not found');
      return { report };
    }
    if (message.action === 'delete') return deleteReport(text(message.reportId, 200, true));
    fail('Unknown competitor report action');
  }
  root.SeoCompetitors = Object.freeze({ ERRORS, appendDraft, readDraft, saveReport, dispatch });
})(globalThis);
