/* Shared analysis queue; persistence only, never schedules searches. */
(function (root) {
  'use strict';
  const KEY = 'seoAnalysisQueries';
  let pending = Promise.resolve();
  const fail = message => { throw new Error(message); };
  const clean = value => {
    if (typeof value !== 'string' || value.length > 100000) fail('Запрос должен быть текстом.');
    const result = value.trim().replace(/\s+/g, ' ');
    if (result.length > 500) fail('В запросе должно быть не больше 500 символов.');
    return result;
  };
  const key = query => query.toLowerCase();
  function normalize(value) {
    const input = typeof value === 'string' ? value.split(/\r?\n/) : value;
    if (!Array.isArray(input) || input.length > 1000) fail('Передайте список запросов.');
    const result = [], seen = new Set();
    for (const item of input) {
      const query = clean(item);
      if (!query || seen.has(key(query))) continue;
      seen.add(key(query)); result.push(query);
      if (result.length > 20) fail('В очереди может быть не больше 20 запросов. Удалите лишний запрос.');
    }
    return result;
  }
  function extension(sender) {
    const origin = chrome.runtime.getURL('');
    return typeof sender.url === 'string' && sender.url.startsWith(origin) && (!sender.tab || typeof sender.tab.url === 'string' && sender.tab.url.startsWith(origin));
  }
  function supported(value) {
    let url;
    try { url = new URL(value); } catch { return false; }
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && (/^(?:www\.)?(?:google|yandex)\.(?:com|ru)$/.test(url.hostname) || url.hostname === 'wordstat.yandex.ru');
  }
  async function authenticate(sender) {
    if (!sender || sender.id !== chrome.runtime.id) fail('Недоверенный источник очереди запросов.');
    if (extension(sender)) return;
    if (!sender.tab || !Number.isInteger(sender.tab.id) || !supported(sender.url) || sender.url !== sender.tab.url) fail('Очередь доступна только на поддерживаемых страницах.');
    let tab;
    try { tab = await chrome.tabs.get(sender.tab.id); } catch { fail('Вкладка недоступна.'); }
    if (!supported(tab.url) || tab.url !== sender.url) fail('Страница изменилась. Повторите действие.');
  }
  async function execute(message, sender) {
    await authenticate(sender);
    if (!message || typeof message !== 'object' || !['get', 'add', 'remove', 'replace', 'clear'].includes(message.action)) fail('Неизвестное действие очереди запросов.');
    // Validate input before reading persistence, and authenticate before any storage access.
    let query, replacement;
    if (message.action === 'add' || message.action === 'remove') { query = clean(message.query); if (!query) fail('Введите непустой запрос.'); }
    if (message.action === 'replace') replacement = normalize(message.queries);
    const data = await chrome.storage.local.get(KEY);
    let queries = normalize(data[KEY] === undefined ? [] : data[KEY]);
    if (message.action === 'get') return queries;
    if (message.action === 'clear') queries = [];
    if (message.action === 'replace') queries = replacement;
    if (message.action === 'add') queries = normalize([...queries, query]);
    if (message.action === 'remove') queries = queries.filter(item => key(item) !== key(query));
    await chrome.storage.local.set({ [KEY]: queries });
    return queries;
  }
  function dispatch(message, sender) {
    const result = pending.then(() => execute(message, sender));
    pending = result.catch(() => {});
    return result;
  }
  root.SeoAnalysisQueue = Object.freeze({ dispatch });
})(globalThis);
