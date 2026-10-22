/* Saved lists schema, cache and folder mirror. Runs in the MV3 service worker. */
(function (root) {
  'use strict';
  const KEYS = ['seoListsData', 'currentListId', 'seoListsSelectedListId', 'seoListsSync', 'seoListsMirrorFingerprint'];
  const LIMIT = { lists: 200, items: 20000, tags: 100, tag: 100, name: 200, text: 100000, url: 8192, bytes: 10000000 };
  const freshSync = () => ({ connected: false, directoryName: null, pending: false, error: null, lastSyncedAt: null });
  const fail = message => { throw new Error(message); };
  function string(value, label, max, nonempty = false) {
    if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim())) fail(`Invalid ${label}`);
    return value;
  }
  function tags(value = []) {
    if (!Array.isArray(value) || value.length > LIMIT.tags) fail('Invalid tags');
    const seen = new Set();
    return value.map(tag => string(tag, 'tag', LIMIT.tag).trim()).filter(tag => {
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`Invalid ${label}`);
  }
  function fields(value, allowed, label) {
    object(value, label);
    if (Object.keys(value).some(key => !allowed.includes(key))) fail(`Unknown ${label} field`);
  }
  function date(value) {
    string(value, 'ISO date', 40, true);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail('Invalid ISO date');
    // Reject normalized impossible calendar days, while allowing explicit offsets.
    const day = value.slice(0, 10);
    if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) fail('Invalid ISO date');
    return value;
  }
  function url(value) {
    string(value, 'URL', LIMIT.url, true);
    let parsed;
    try { parsed = new URL(value); } catch { fail('Invalid URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) fail('Only HTTP(S) URLs can be saved');
    return value;
  }
  function validateData(input) {
    fields(input, ['version', 'lists'], 'data');
    if (input.version !== 1 || !Array.isArray(input.lists) || input.lists.length > LIMIT.lists) fail('Invalid lists schema/version');
    if (JSON.stringify(input).length > LIMIT.bytes) fail('Lists file is too large');
    const listIds = new Set(), itemIds = new Set();
    let count = 0;
    const unique = (id, set) => { string(id, 'id', 200, true); if (set.has(id)) fail('Duplicate ID'); set.add(id); return id; };
    return { version: 1, lists: input.lists.map(list => {
      fields(list, ['id', 'name', 'createdAt', 'tags', 'items'], 'list');
      if (!Array.isArray(list.items) || (count += list.items.length) > LIMIT.items) fail('Too many saved URLs');
      const result = { id: unique(list.id, listIds), name: string(list.name, 'list name', LIMIT.name, true), createdAt: date(list.createdAt), tags: tags(list.tags), items: list.items.map(item => {
        fields(item, ['id', 'url', 'title', 'comment', 'tags', 'createdAt', 'updatedAt'], 'item');
        return { id: unique(item.id, itemIds), url: url(item.url), title: string(item.title, 'title', LIMIT.text), comment: string(item.comment, 'comment', LIMIT.text), tags: tags(item.tags), createdAt: date(item.createdAt), updatedAt: date(item.updatedAt) };
      }) };
      result.tags = tags([...new Set([...result.tags, ...result.items.flatMap(item => item.tags)])]);
      return result;
    }) };
  }
  const id = () => crypto.randomUUID();
  const clone = value => JSON.parse(JSON.stringify(value));
  function unionData(local, incoming) {
    const result = validateData(local), addition = validateData(incoming);
    const itemIds = new Map(result.lists.flatMap(list => list.items.map(item => [item.id, { item, listId: list.id }])));
    for (const source of addition.lists) {
      let target = result.lists.find(list => list.id === source.id);
      if (target && target.name !== source.name) target = null;
      if (!target) {
        target = { ...source, id: result.lists.some(list => list.id === source.id) ? id() : source.id, items: [] };
        result.lists.push(target);
      }
      target.tags = tags([...new Set([...target.tags, ...source.tags])]);
      for (const item of source.items) {
        const existing = itemIds.get(item.id);
        if (existing && existing.listId === target.id) {
          const withoutTags = record => { const { tags: ignored, ...rest } = record; return rest; };
          if (JSON.stringify(withoutTags(existing.item)) === JSON.stringify(withoutTags(item))) {
            existing.item.tags = tags([...new Set([...existing.item.tags, ...item.tags])]);
            continue;
          }
        }
        const copy = { ...item, tags: [...item.tags], id: existing ? id() : item.id };
        target.items.push(copy); itemIds.set(copy.id, { item: copy, listId: target.id });
      }
    }
    return validateData(result);
  }
  function handles(operation, value) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('seoListsFS', 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('handles')) request.result.createObjectStore('handles'); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('handles', operation === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('handles');
        const action = operation === 'get' ? store.get('directory') : operation === 'delete' ? store.delete('directory') : store.put(value, 'directory');
        let result;
        action.onsuccess = () => { result = action.result; };
        tx.oncomplete = () => { db.close(); resolve(result); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('Directory storage aborted')); };
      };
    });
  }
  let state, approvedFingerprint = null, queue = Promise.resolve();
  async function fingerprint(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function load() {
    if (state) return;
    const saved = await chrome.storage.local.get(KEYS);
    const data = saved.seoListsData ? validateData(saved.seoListsData) : { version: 1, lists: [] };
    approvedFingerprint = saved.seoListsMirrorFingerprint || null;
    const selected = saved.currentListId ?? saved.seoListsSelectedListId;
    state = { data, selectedListId: data.lists.some(list => list.id === selected) ? selected : data.lists[0]?.id || null, sync: { ...freshSync(), ...saved.seoListsSync } };
  }
  async function persist() {
    await chrome.storage.local.set({ seoListsData: state.data, currentListId: state.selectedListId, seoListsSync: state.sync, seoListsMirrorFingerprint: approvedFingerprint });
  }
  async function existingFile(directory) {
    let fileHandle;
    try { fileHandle = await directory.getFileHandle('seo-lists.json'); }
    catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
    const file = await fileHandle.getFile();
    if (file.size > LIMIT.bytes) fail('Existing seo-lists.json is too large; file unchanged');
    const text = await file.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { fail('Existing seo-lists.json is invalid JSON; file unchanged'); }
    return { data: validateData(parsed), fingerprint: await fingerprint(text) };
  }
  async function mirror(connect = false) {
    let directory;
    try {
      directory = await handles('get');
      if (!directory) {
        if (connect) fail('Choose a folder first');
        if (state.sync.connected) fail('Folder connection is unavailable');
        return;
      }
      if (!connect && !state.sync.connected) return;
      if (await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') fail('Folder permission required; open the library and grant access');
      const external = await existingFile(directory);
      if (!connect && ((external && external.fingerprint !== approvedFingerprint) || (!external && approvedFingerprint))) fail('Folder file changed outside the extension; reconnect the folder to merge safely');
      if (connect && external) {
        state.data = unionData(state.data, external.data);
        if (!state.selectedListId) state.selectedListId = state.data.lists[0]?.id || null;
        state.sync.pending = true;
        await persist();
      }
      const file = await directory.getFileHandle('seo-lists.json', { create: true });
      const writable = await file.createWritable();
      const text = JSON.stringify(state.data, null, 2);
      try { await writable.write(text); await writable.close(); }
      catch (error) { try { await writable.abort(); } catch {} throw error; }
      approvedFingerprint = await fingerprint(text);
      state.sync = { connected: true, directoryName: directory.name, pending: false, error: null, lastSyncedAt: new Date().toISOString() };
      await persist();
    } catch (error) {
      state.sync.pending = true;
      state.sync.error = error.message || String(error);
      // A rejected newly selected folder is never marked as a working connection.
      if (connect) {
        state.sync.connected = false; state.sync.directoryName = null; approvedFingerprint = null;
        await handles('delete');
      }
      await persist();
      if (connect) throw error;
    }
  }
  async function execute(message) {
    await load();
    const action = message.action;
    if (action === 'get') return clone(state);
    if (action === 'connectDirectory') { await mirror(true); return clone(state); }
    if (action === 'sync') { await mirror(); return clone(state); }
    if (action === 'disconnectDirectory') {
      await handles('delete'); approvedFingerprint = null; state.sync = { ...freshSync(), lastSyncedAt: state.sync.lastSyncedAt }; await persist(); return clone(state);
    }
    const previous = clone(state);
    try {
      const list = () => state.data.lists.find(entry => entry.id === message.listId) || fail('List not found');
      const item = target => target.items.find(entry => entry.id === message.itemId) || fail('Saved URL not found');
      const now = new Date().toISOString();
      switch (action) {
        case 'createList': {
          const entry = { id: id(), name: string(message.name, 'list name', LIMIT.name, true).trim(), createdAt: now, tags: [], items: [] };
          state.data.lists.push(entry); state.selectedListId = entry.id; break;
        }
        case 'selectList': list(); state.selectedListId = message.listId; break;
        case 'renameList': list().name = string(message.name, 'list name', LIMIT.name, true).trim(); break;
        case 'deleteList': list(); state.data.lists = state.data.lists.filter(entry => entry.id !== message.listId); if (state.selectedListId === message.listId) state.selectedListId = state.data.lists[0]?.id || null; break;
        case 'addItem': {
          const target = list(), itemTags = tags(message.tags);
          target.items.push({ id: id(), url: url(message.url), title: string(message.title ?? '', 'title', LIMIT.text), comment: string(message.comment ?? '', 'comment', LIMIT.text), tags: itemTags, createdAt: now, updatedAt: now });
          target.tags = tags([...new Set([...target.tags, ...itemTags])]); break;
        }
        case 'updateComment': { const entry = item(list()); entry.comment = string(message.comment, 'comment', LIMIT.text); entry.updatedAt = now; break; }
        case 'updateTags': { const target = list(), entry = item(target); entry.tags = tags(message.tags); entry.updatedAt = now; target.tags = tags([...new Set([...target.tags, ...entry.tags])]); break; }
        case 'removeItem': { const target = list(); item(target); target.items = target.items.filter(entry => entry.id !== message.itemId); break; }
        case 'importData': state.data = unionData(state.data, message.data); if (!state.selectedListId) state.selectedListId = state.data.lists[0]?.id || null; break;
        default: fail('Unknown lists action');
      }
      state.data = validateData(state.data);
      if (action !== 'selectList') { state.sync.pending = true; state.sync.error = null; }
      await persist();
    } catch (error) { state = previous; throw error; }
    if (action !== 'selectList') await mirror();
    return clone(state);
  }
  function dispatch(message) {
    const result = queue.then(() => execute(message));
    queue = result.catch(() => {});
    return result;
  }
  root.SeoListsStore = { dispatch, validateData, unionData, limits: Object.freeze({ ...LIMIT }) };
})(globalThis);
