'use strict';
(() => {
 const $ = id => document.getElementById(id);
 const button = document.querySelector('[data-tab="gsc"]');
 let activeTab = null, generation = 0, busy = false;
 function node(tag, text) { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; return result; }
 function date(value) { return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ru-RU') : '—'; }
 function delta(value) { return Number.isSafeInteger(value) ? `${value > 0 ? '+' : ''}${value}` : '—'; }
 function folderStatus(sync) {
  if (!sync?.pending) return sync?.connected && sync?.lastSyncedAt ? 'JSON: синхронизировано' : 'История хранится локально. Папка подключается в LISTS / библиотеке.';
  if (!sync.connected) return 'История сохранена локально. JSON ожидает синхронизации: откройте библиотеку и подключите папку JSON.';
  const error = sync.error || '';
  if (/access|permission|notallowed/i.test(error)) return 'История сохранена локально. Для записи JSON откройте библиотеку → «Разрешить доступ / синхронизировать», подтвердите доступ к прежней папке, затем вернитесь в GSC и нажмите «Синхронизировать JSON».';
  if (/changed|disconnected|handle.*unavailable/i.test(error)) return 'История сохранена локально. Подключение папки изменилось или недоступно. Проверьте прежнюю папку в библиотеке и повторите синхронизацию JSON в GSC.';
  return 'История сохранена локально. JSON пока не обновлён. Проверьте файл истории и доступ к папке в библиотеке, затем повторите синхронизацию JSON в GSC.';
 }
 async function call(action, tab, snapshot) {
  const result = await chrome.runtime.sendMessage({type: 'seoGscHistory', action, tabId: tab.id,
   resourceId: globalThis.SeoGscPage.resource(tab.url), ...(snapshot ? {snapshot} : {})});
  if (!result?.ok) throw new Error(result?.error || 'История Search Console недоступна.');
  return result.result;
 }
 function render(state) {
  const summary = state?.summary;
  $('gsc-resource').textContent = state?.resourceId || globalThis.SeoGscPage.resource(activeTab?.url);
  const working = state?.workingDay;
  const coverage = working ? ` · собрано ${working.collected} из ${working.total}${working.complete ? ' · полный день' : ' · сбор не завершён'}` : '';
  $('gsc-last').textContent = summary?.lastCheckedAt ? `Последняя проверка: ${date(summary.lastCheckedAt)}${summary.noChanges && summary.baselineDay ? ' · Без изменений к предыдущему дню' : ''}${coverage}` : 'Сохранённых дней пока нет. Первая страница станет исходной.';
  const sync = state?.sync;
  $('gsc-sync').textContent = folderStatus(sync);
  const table = node('table'), head = node('tr');
  for (const label of ['Домен', 'Страниц со ссылками', 'Δ', 'Страниц назначения', 'Δ', 'Впервые сохранён']) head.append(node('th', label));
  const thead = node('thead'); thead.append(head); table.append(thead);
  const body = node('tbody');
  for (const item of summary?.domains || []) {
   const row = node('tr');
   const labels = {new: ' · NEW', removed: ' · исчез', unconfirmed: ' · ещё не проверен', changed: '', unchanged: ''};
   for (const value of [item.domain + (labels[item.status] || ''), String(item.links), delta(item.deltaLinks), String(item.targetPages), delta(item.deltaTargetPages), date(item.firstSeenAt)]) row.append(node('td', value));
   body.append(row);
  }
  table.append(body); $('gsc-results').replaceChildren(table);
  const history = Array.isArray(state?.history) ? state.history : [];
  $('gsc-history').replaceChildren();
  for (const entry of history.slice().reverse()) $('gsc-history').append(node('li', `${entry.day} · собрано ${entry.collected} из ${entry.total}${entry.complete ? ' · полный день' : ' · сбор не завершён'}`));
 }
 async function refresh() {
  const current = ++generation;
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (current !== generation) return;
  activeTab = globalThis.SeoGscPage.page(tab?.url) ? tab : null;
  button.hidden = !activeTab;
  $('gsc-capture').disabled = busy || !globalThis.SeoGscPage.resource(activeTab?.url);
  if (!activeTab) {
   if (button.classList.contains('active')) selectInspectorTab('meta');
   return;
  }
  if (!globalThis.SeoGscPage.resource(activeTab.url)) { $('gsc-status').textContent = 'Не удалось определить ресурс Search Console.'; return; }
  try {
   const state = await call('get', activeTab);
   if (current === generation) { render(state); $('gsc-status').textContent = ''; }
  } catch (error) { if (current === generation) $('gsc-status').textContent = error.message; }
 }
 $('gsc-capture').addEventListener('click', async () => {
  if (busy) return;
  const current = ++generation;
  busy = true; $('gsc-capture').disabled = true; $('gsc-status').textContent = 'Проверяем открытую страницу таблицы…';
  try {
   const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
   if (!globalThis.SeoGscPage.page(tab?.url) || !globalThis.SeoGscPage.resource(tab.url)) throw new Error('Откройте общий отчёт по доменам Search Console и повторите сохранение.');
   if (current !== generation) return;
   activeTab = tab;
   button.hidden = false;
   await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['gsc-page.js']});
   const results = await chrome.scripting.executeScript({target: {tabId: tab.id}, args: [tab.url], func: async expectedUrl => {
    try { return {snapshot: await globalThis.SeoGscPage.freshSnapshot(expectedUrl)}; }
    catch (error) { return {error: error.message}; }
   }});
   const collected = results[0]?.result;
   if (collected?.error) throw new Error(collected.error);
   const [actual] = await chrome.tabs.query({active: true, currentWindow: true});
   if (current !== generation || actual?.id !== tab.id || actual.url !== tab.url || collected?.snapshot?.url !== tab.url ||
       collected.snapshot.resourceId !== globalThis.SeoGscPage.resource(tab.url)) throw new Error('Страница изменилась во время чтения. Повторите проверку.');
   const state = await call('capture', actual, collected.snapshot);
   if (current !== generation) return;
   render(state); $('gsc-status').textContent = state.summary?.unchangedCapture ? 'Без изменений · время проверки обновлено.' : 'Страница добавлена в накопленный день по Москве.';
   await chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => globalThis.SeoGscPage?.annotate()}).catch(() => {});
  } catch (error) { if (current === generation) $('gsc-status').textContent = error.message; }
  finally { busy = false; $('gsc-capture').disabled = !globalThis.SeoGscPage.resource(activeTab?.url); }
 });
 $('gsc-sync-now').addEventListener('click', async () => {
  if (busy || !activeTab) return;
  const current = ++generation;
  busy = true; $('gsc-sync-now').disabled = true;
  try {
   const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
   if (!globalThis.SeoGscPage.page(tab?.url) || !globalThis.SeoGscPage.resource(tab.url)) throw new Error('Откройте общий отчёт Search Console и повторите синхронизацию.');
   if (current !== generation) return;
   activeTab = tab;
   const state = await call('sync', tab);
   if (current === generation) {
    render(state);
    $('gsc-status').textContent = state.sync?.pending ? 'Разрешите доступ к папке в библиотеке и повторите синхронизацию.' :
     state.sync?.connected && state.sync?.lastSyncedAt ? 'JSON синхронизирован.' : 'История хранится локально. Подключите папку в библиотеке; без сохранённых страниц синхронизировать нечего.';
   }
  } catch (error) { if (current === generation) $('gsc-status').textContent = error.message; }
  finally { busy = false; $('gsc-sync-now').disabled = false; }
 });
 $('gsc-open-library').addEventListener('click', () => chrome.tabs.create({url: chrome.runtime.getURL('library.html')}));
 chrome.tabs.onActivated?.addListener(() => { void refresh(); });
 chrome.tabs.onUpdated?.addListener((id, changes) => { if (id === activeTab?.id && changes.url) void refresh(); });
 globalThis.SeoGscPopup = {refresh};
 void refresh();
})();
