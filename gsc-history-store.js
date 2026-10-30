/* Private local GSC history, with an optional independent connected-folder mirror. */
(function (root) {
  'use strict';
  const model = root.SeoGscHistoryModel;
  const DATABASE = 'seoGscHistory1';
  let queue = Promise.resolve();
  const fail = message => { throw new Error(message); };
  const clone = value => JSON.parse(JSON.stringify(value));
  const freshSync = () => ({ pending: false, error: null, lastSyncedAt: null });
  function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('resources');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }
  async function record(resource, value) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('resources', value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('resources');
      const request = value === undefined ? store.get(resource) : store.put(value, resource);
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('GSC history storage aborted')); };
    });
  }
  async function load(resource) {
    const saved = await record(resource);
    if (!saved) return { history: model.empty(resource), sync: freshSync() };
    const history = model.validateHistory(saved.history, resource);
    const sync = saved.sync;
    if (!sync || typeof sync.pending !== 'boolean' || sync.error !== null && typeof sync.error !== 'string' || sync.lastSyncedAt !== null && (typeof sync.lastSyncedAt !== 'string' || !Number.isFinite(Date.parse(sync.lastSyncedAt)))) fail('Invalid local GSC synchronization state');
    return { history, sync: { pending: sync.pending, error: sync.error, lastSyncedAt: sync.lastSyncedAt } };
  }
  async function directoryHandle() {
    if (typeof indexedDB.databases === 'function' && !(await indexedDB.databases()).some(item => item.name === 'seoListsFS')) return null;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('seoListsFS', 1);
      // Never create or upgrade the lists database as a side effect of a read.
      request.onupgradeneeded = () => request.transaction.abort();
      request.onerror = () => request.error?.name === 'AbortError' ? resolve(null) : reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('handles')) { db.close(); resolve(null); return; }
        const tx = db.transaction('handles', 'readonly');
        const action = tx.objectStore('handles').get('directory');
        let result;
        action.onsuccess = () => { result = action.result; };
        tx.oncomplete = () => { db.close(); resolve(result || null); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('Folder handle read aborted')); };
      };
    });
  }
  async function fingerprint(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function externalFile(directory, name, resource) {
    let handle;
    try { handle = await directory.getFileHandle(name); }
    catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
    const file = await handle.getFile();
    if (file.size > model.LIMIT.bytes) fail('GSC folder history is too large; file unchanged');
    const text = await file.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { fail('GSC folder history is not valid JSON; file unchanged'); }
    return { history: model.validateHistory(parsed, resource), fingerprint: await fingerprint(text), handle };
  }
  async function connected() {
    const saved = await chrome.storage.local.get('seoListsSync');
    return saved.seoListsSync?.connected === true;
  }
  async function verifyDirectory(directory) {
    if (!await connected()) fail('Folder was disconnected; local history retained');
    const current = await directoryHandle();
    if (!current || typeof directory.isSameEntry !== 'function' || !await directory.isSameEntry(current)) fail('Connected folder changed; local history retained, retry synchronization');
    if (await current.queryPermission({ mode: 'readwrite' }) !== 'granted') fail('Folder access changed; local history retained');
    if (!await connected()) fail('Folder was disconnected; local history retained');
  }
  async function mirror(state) {
    const resource = state.history.resourceId;
    try {
      if (!await connected()) {
        state.sync = { ...state.sync, pending: state.history.events.length > 0, error: null };
        await record(resource, state); return state;
      }
      const directory = await directoryHandle();
      if (!directory) fail('Connected folder handle is unavailable; local history retained');
      if (await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') fail('Folder access is unavailable; grant access in the library');
      const name = await model.fileName(resource);
      const external = await externalFile(directory, name, resource);
      const merged = external ? model.merge(state.history, external.history) : state.history;
      // Persist the validated union locally before attempting a fallible file write.
      state = { history: merged, sync: { ...state.sync, pending: true, error: null } };
      await record(resource, state);
      if (!await connected()) fail('Folder was disconnected; local history retained');
      const current = await externalFile(directory, name, resource);
      if ((current?.fingerprint ?? null) !== (external?.fingerprint ?? null)) fail('GSC folder history changed during synchronization; retry to merge safely');
      await verifyDirectory(directory);
      const file = current?.handle || await directory.getFileHandle(name, { create: true });
      const writable = await file.createWritable({ mode: 'exclusive' });
      try {
        const before = await file.getFile();
        const beforeText = await before.text();
        if (current ? await fingerprint(beforeText) !== current.fingerprint : beforeText !== '') fail('GSC folder history changed before writing; retry to merge safely');
        await verifyDirectory(directory);
        await writable.write(JSON.stringify(merged, null, 2));
        await verifyDirectory(directory);
        await writable.close();
      } catch (error) { try { await writable.abort(); } catch {} throw error; }
      state.sync = { pending: false, error: null, lastSyncedAt: new Date().toISOString() };
    } catch (error) {
      state.sync = { ...state.sync, pending: true, error: error.message || 'GSC folder synchronization failed' };
    }
    await record(resource, state);
    return state;
  }
  function extension(sender) {
    const base = chrome.runtime.getURL('');
    return !!sender && sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(base) && (!sender.tab || typeof sender.tab.url === 'string' && sender.tab.url.startsWith(base));
  }
  async function matchingTab(tabId, resource, expectedUrl) {
    if (!Number.isInteger(tabId)) fail('A supported Search Console tab is required');
    const tab = await chrome.tabs.get(tabId);
    const source = model.page(tab.url);
    if (source.resourceId !== resource || expectedUrl !== undefined && source.url !== expectedUrl) fail('Search Console tab or resource changed; capture again');
    return source;
  }
  async function result(state) {
    return clone({ resourceId: state.history.resourceId, history: state.history.days, workingDay: state.history.workingDay, summary: model.summarize(state.history), sync: { ...state.sync, connected: await connected(), fileName: await model.fileName(state.history.resourceId) } });
  }
  async function execute(message, sender) {
    if (!message || typeof message !== 'object' || sender?.id !== chrome.runtime.id) fail('Untrusted GSC history sender');
    const resource = model.resourceId(message.resourceId);
    const trusted = extension(sender);
    if (!trusted) {
      if (message.action !== 'pageState' || !sender.tab || !Number.isInteger(sender.tab.id) || typeof sender.url !== 'string' || typeof sender.tab.url !== 'string' || sender.url !== sender.tab.url || message.tabId !== undefined && message.tabId !== sender.tab.id) fail('Search Console content may only read its own page state');
      await matchingTab(sender.tab.id, resource, sender.url);
      const state = await load(resource);
      return clone({ resourceId: resource, summary: model.summarize(state.history) });
    }
    if (!['get', 'capture', 'sync'].includes(message.action)) fail('Unknown GSC history action');
    await matchingTab(message.tabId, resource);
    let state = await load(resource);
    if (message.action === 'capture') {
      const observation = model.snapshot(message.snapshot);
      if (observation.resourceId !== resource) fail('Capture belongs to another resource');
      const capturedAt = new Date().toISOString();
      // Recheck the actual tab after asynchronous reads, immediately before commit.
      await matchingTab(message.tabId, resource, observation.url);
      state.history = model.append(state.history, observation, { id: crypto.randomUUID(), capturedAt });
      state.sync = { ...state.sync, pending: true, error: null };
      await record(resource, state);
      state = await mirror(state);
    } else if (message.action === 'sync') state = await mirror(state);
    return result(state);
  }
  function dispatch(message, sender) {
    const response = queue.then(() => execute(message, sender));
    queue = response.catch(() => {});
    return response;
  }
  root.SeoGscHistoryStore = Object.freeze({ dispatch });
})(globalThis);
