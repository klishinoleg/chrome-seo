/* One explicitly started SERP run; all mutations are serialized and session-persisted. */
(function (root) {
  'use strict';
  const KEY = 'seoRankRunState';
  const ACTIVE = new Set(['running', 'waiting', 'paused']);
  const KINDS = new Set(['results', 'captcha', 'consent', 'unknown']);
  let queue = Promise.resolve(), cached = null;
  const cancellations = new Set();
  const fail = message => { throw new Error(message); };
  const canonical = value => { try { const url = new URL(value); url.hash = ''; return url.href; } catch { return ''; } };
  const queryText = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  function engineHost(url) {
    if (url.protocol !== 'https:') return null;
    if (/^(?:www\.)?google\.(?:com|ru)$/.test(url.hostname)) return 'google';
    if (/^(?:www\.)?yandex\.(?:ru|com)$/.test(url.hostname)) return 'yandex';
    return null;
  }
  function serp(value) {
    let url;
    try { url = new URL(value); } catch { return null; }
    const engine = engineHost(url);
    if (!engine || !/^\/search\/?$/.test(url.pathname)) return null;
    if (engine === 'google' && !url.hostname.startsWith('www.')) return null;
    const query = queryText(url.searchParams.get(engine === 'google' ? 'q' : 'text'));
    const offset = url.searchParams.get(engine === 'google' ? 'start' : 'p') || '0';
    if (!query || !/^\d{1,6}$/.test(offset)) return null;
    const cursor = Number(offset);
    return { url, engine, query, cursor, page: engine === 'google' ? Math.floor(cursor / 10) + 1 : cursor + 1 };
  }
  function domain(value) {
    if (typeof value !== 'string' || value.length > 253 || !value.trim()) fail('Enter a target domain');
    const raw = value.trim();
    if (/[\s/@?#:\\]/.test(raw)) fail('Enter a domain without a URL path');
    let hostname;
    try { hostname = new URL(`https://${raw}`).hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, ''); } catch { fail('Invalid target domain'); }
    if (hostname.length > 253 || !hostname.includes('.') || hostname.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) fail('Invalid target domain');
    return hostname;
  }
  const extension = sender => Boolean(sender && sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL('')) && (!sender.tab || typeof sender.tab.url === 'string' && sender.tab.url.startsWith(chrome.runtime.getURL(''))));
  async function read() { const data = await chrome.storage.session.get(KEY); cached = data[KEY] || null; return cached; }
  async function write(state) { cached = state; await chrome.storage.session.set({ [KEY]: state }); return state; }
  function publicState(state) {
    if (!state) return null;
    const { seenUrls, visitedUrls, pendingUrl, processedUrl, ...result } = state;
    return result;
  }
  function pause(state, reason) { return { ...state, status: 'paused', reason, nextAt: null, pendingUrl: null }; }
  async function contentTab(sender, state) {
    if (!sender || sender.id !== chrome.runtime.id || !sender.tab || !Number.isInteger(sender.tab.id) || typeof sender.url !== 'string' || typeof sender.tab.url !== 'string') fail('Run commands require the search tab');
    if (state && sender.tab.id !== state.tabId) fail('This run belongs to another tab');
    let tab;
    try { tab = await chrome.tabs.get(sender.tab.id); } catch { fail('Search tab is closed'); }
    let actual; try { actual = new URL(tab.url); } catch { fail('Unsupported search tab'); }
    if (!engineHost(actual) || (!serp(tab.url) && !/sorry|captcha|showcaptcha|consent/i.test(actual.pathname))) fail('Unsupported search tab');
    if (!tab.url || canonical(sender.url) !== canonical(sender.tab.url) || canonical(sender.url) !== canonical(tab.url)) fail('Stale search tab message');
    return tab;
  }
  function sameSearch(info, state) { return info && info.engine === state.engine && info.query === state.query; }
  function nextUrl(value, state) {
    if (typeof value !== 'string' || value.length > 8192) return null;
    const current = serp(state.expectedUrl), next = serp(value);
    if (!current || !sameSearch(next, state) || next.url.origin !== current.url.origin || next.url.pathname !== current.url.pathname || next.cursor <= current.cursor || state.visitedUrls.includes(canonical(value))) return null;
    return canonical(value);
  }
  async function navigateDue(state) {
    if (!state || state.status !== 'waiting' || !state.pendingUrl || Date.now() < state.nextAt) return state;
    if (cancellations.has(state.id)) return write({ ...state, status: 'stopped', reason: 'Stopped by user', nextAt: null, pendingUrl: null });
    let tab;
    try { tab = await chrome.tabs.get(state.tabId); } catch { return write({ ...state, status: 'stopped', reason: 'Search tab closed', nextAt: null, pendingUrl: null }); }
    if (!tab.url || canonical(tab.url) !== state.expectedUrl) return write(pause(state, 'Search tab changed; return to the expected results page'));
    const destination = state.pendingUrl;
    // Read the persisted cancellation/state immediately before scheduling navigation.
    const latest = await read();
    if (!latest || latest.id !== state.id || latest.status !== 'waiting' || cancellations.has(state.id)) return latest;
    const running = { ...latest, expectedUrl: destination, status: 'running', reason: '', nextAt: null, pendingUrl: null, processedUrl: null };
    await write(running);
    let currentTab;
    try { currentTab = await chrome.tabs.get(running.tabId); } catch { return write({ ...running, status: 'stopped', reason: 'Search tab closed' }); }
    if (canonical(currentTab.url) !== state.expectedUrl) return write(pause({ ...running, expectedUrl: state.expectedUrl }, 'Search tab changed before navigation'));
    if (cancellations.has(running.id)) return write({ ...running, status: 'stopped', reason: 'Stopped by user' });
    try { await chrome.tabs.update(running.tabId, { url: destination }); } catch { return write(pause(running, 'Could not open the next results page')); }
    return running;
  }
  async function execute(message, sender, verifiedStop = false) {
    if (!message || typeof message !== 'object' || sender?.id !== chrome.runtime.id) fail('Untrusted rank-run sender');
    let state = await read();
    if (message.action === 'start') {
      const tab = await contentTab(sender);
      const source = serp(tab.url);
      if (!source) fail('Start from a supported Google or Yandex results page');
      if (state && ACTIVE.has(state.status)) fail('Stop the active run before starting another');
      const query = queryText(message.query);
      if (!query || query.length > 500) fail('Enter a search query up to 500 characters');
      const targetDomain = domain(message.targetDomain);
      const url = new URL(source.url.origin + source.url.pathname);
      url.searchParams.set(source.engine === 'google' ? 'q' : 'text', query);
      state = { id: crypto.randomUUID(), tabId: tab.id, engine: source.engine, query, targetDomain, status: 'running', reason: '', pagesVisited: 0, resultsSeen: 0, currentPage: 1, found: null, expectedUrl: url.href, nextAt: null, pendingUrl: null, processedUrl: null, seenUrls: [], visitedUrls: [] };
      await write(state);
      const latest = await read();
      if (!latest || latest.id !== state.id || latest.status !== 'running') return publicState(latest);
      let currentTab;
      try { currentTab = await chrome.tabs.get(tab.id); } catch { return publicState(await write({ ...state, status: 'stopped', reason: 'Search tab closed' })); }
      if (canonical(currentTab.url) !== canonical(tab.url)) return publicState(await write(pause(state, 'Search tab changed before starting')));
      if (cancellations.has(state.id)) return publicState(await write({ ...state, status: 'stopped', reason: 'Stopped by user', nextAt: null, pendingUrl: null }));
      try { await chrome.tabs.update(tab.id, { url: state.expectedUrl }); } catch { state = await write(pause(state, 'Could not open the first results page')); }
      return publicState(state);
    }
    if (!state) {
      if (!extension(sender)) await contentTab(sender);
      if (message.action === 'getStatus') return null;
      fail('No rank run is available');
    }
    const isExtension = extension(sender);
    if (isExtension) {
      if (!['getStatus', 'stop'].includes(message.action)) fail('Use the bound search tab for this action');
      if (message.action === 'stop' && message.runId !== state.id) fail('Stale run ID');
    } else {
      if (!(verifiedStop && message.action === 'stop')) await contentTab(sender, state);
      if (message.action !== 'getStatus' && message.runId !== state.id) fail('Stale run ID');
    }
    if (message.action === 'getStatus') return publicState(await navigateDue(state));
    if (message.action === 'stop') {
      cancellations.add(state.id);
      return publicState(await write({ ...state, status: 'stopped', reason: 'Stopped by user', nextAt: null, pendingUrl: null }));
    }
    if (message.action === 'resume') {
      if (state.status !== 'paused') fail('Only a paused run can resume');
      const info = serp(sender.url);
      if (!sameSearch(info, state) || canonical(sender.url) !== state.expectedUrl) fail('Return to the expected results page before resuming');
      return publicState(await write({ ...state, status: 'running', reason: '', processedUrl: null }));
    }
    if (message.action !== 'snapshot') fail('Unknown rank-run action');
    if (state.status !== 'running') return publicState(state);
    const snapshot = message.snapshot;
    if (!snapshot || typeof snapshot !== 'object' || !KINDS.has(snapshot.kind) || typeof snapshot.url !== 'string' || snapshot.url.length > 8192) fail('Invalid results snapshot');
    if (canonical(snapshot.url) !== canonical(sender.url) || canonical(snapshot.url) !== state.expectedUrl) return publicState(await write(pause(state, 'Unexpected page; search URL changed')));
    if (snapshot.kind !== 'results') return publicState(await write(pause(state, snapshot.kind === 'captcha' ? 'CAPTCHA requires manual completion' : snapshot.kind === 'consent' ? 'Consent requires manual action' : 'Results could not be recognized')));
    const info = serp(snapshot.url);
    if (!sameSearch(info, state) || snapshot.engine !== state.engine || queryText(snapshot.query) !== state.query || snapshot.page !== info.page) fail('Snapshot search identity does not match this run');
    if (!Array.isArray(snapshot.results) || snapshot.results.length > 100) fail('Invalid organic results');
    if (state.processedUrl === state.expectedUrl || state.visitedUrls.includes(state.expectedUrl)) return publicState(await write(pause(state, 'This results page has already been counted')));
    const urls = snapshot.results.map(result => {
      if (!result || typeof result.url !== 'string' || result.url.length > 8192) fail('Invalid organic result URL');
      let url;
      try { url = new URL(result.url); } catch { fail('Invalid organic result URL'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('Invalid organic result URL');
      url.hash = ''; return url;
    });
    if (!urls.length) return publicState(await write(pause(state, 'No organic results recognized')));
    state = { ...state, pagesVisited: state.pagesVisited + 1, currentPage: info.page, visitedUrls: [...state.visitedUrls, state.expectedUrl], processedUrl: state.expectedUrl, seenUrls: [...state.seenUrls] };
    let positionOnPage = 0;
    for (const url of urls) {
      positionOnPage++;
      state.seenUrls.push(url.href);
      state.resultsSeen++;
      const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
      if (host === state.targetDomain || host.endsWith(`.${state.targetDomain}`)) {
        state.found = { position: state.resultsSeen, page: info.page, positionOnPage, url: url.href };
        state.status = 'found'; state.reason = 'Target domain found'; break;
      }
      if (state.resultsSeen >= 100) break;
    }
    if (!state.found) {
      if (state.resultsSeen >= 100 || state.pagesVisited >= 10) { state.status = 'not-found'; state.reason = 'Target absent from the observed 100 results or 10 pages'; }
      else {
        const next = nextUrl(snapshot.nextUrl, state);
        if (!next) state = pause(state, snapshot.nextUrl ? 'Invalid or repeated next-page URL' : 'Next-page link is unavailable');
        else { state.status = 'waiting'; state.pendingUrl = next; state.nextAt = Date.now() + 2500; state.reason = 'Waiting before the next results page'; }
      }
    }
    return publicState(await write(state));
  }
  function serial(operation) { const result = queue.then(operation); queue = result.catch(() => {}); return result; }
  function dispatch(message, sender) {
    // Validate stop independently while navigation is awaiting storage, then serialize
    // its durable mutation. Unverified tab claims never set cancellation flags.
    if (message?.action === 'stop' && cached && message.runId === cached.id) {
      const candidate = cached;
      return Promise.resolve().then(async () => {
        if (!extension(sender)) await contentTab(sender, candidate);
        if (sender?.id !== chrome.runtime.id) fail('Untrusted rank-run sender');
        cancellations.add(candidate.id);
        return serial(() => execute(message, sender, true));
      });
    }
    return serial(() => execute(message, sender));
  }
  chrome.tabs.onRemoved.addListener(tabId => { serial(async () => { const state = await read(); if (state && state.tabId === tabId && ACTIVE.has(state.status)) await write({ ...state, status: 'stopped', reason: 'Search tab closed', nextAt: null, pendingUrl: null }); }); });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (!change.url) return;
    serial(async () => {
      const state = await read();
      if (!state || state.tabId !== tabId || !['running', 'waiting'].includes(state.status) || canonical(change.url) === state.expectedUrl) return;
      let url; try { url = new URL(change.url); } catch { return; }
      await write(pause(state, engineHost(url) && /sorry|captcha|showcaptcha/i.test(url.pathname) ? 'CAPTCHA requires manual completion' : 'Search tab changed; return to the expected results page'));
    });
  });
  root.SeoRankRunner = Object.freeze({ dispatch });
})(globalThis);
