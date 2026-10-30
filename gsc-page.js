'use strict';
(() => {
 if (globalThis.SeoGscPage) return;
 const marker = 'data-seo-gsc-history';
 const help = 'Снимите фильтры и откройте таблицу доменов с известным диапазоном строк. Сохраняйте каждую страницу отдельно; 500 / 1000 / все строки ускорят сбор.';
 function page(value) {
  try {
   const url = new URL(value);
   if (url.protocol !== 'https:' || url.hostname !== 'search.google.com' || url.port ||
       !/^\/search-console\/links\/drilldown\/?$/.test(url.pathname) || url.username || url.password) return null;
   return url;
  } catch { return null; }
 }
 function resource(value) {
  const url = page(value);
  if (!url || url.searchParams.getAll('resource_id').length !== 1) return null;
  const id = url.searchParams.get('resource_id');
  if (!id || id.length > 2048) return null;
  if (/^sc-domain:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(id)) return id;
  try { const target = new URL(id); return ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password ? id : null; }
  catch { return null; }
 }
 function snapshot() {
  const url = page(location.href), resourceId = resource(location.href);
  const fail = message => { throw new Error(`${message} ${help}`); };
  if (!url || !resourceId) fail('Неизвестная страница или ресурс Search Console.');
  if (url.searchParams.getAll('type').length !== 1 || url.searchParams.get('type') !== 'DOMAIN') fail('Откройте общий отчёт по доменам (DOMAIN).');
  const allowed = new Set(['resource_id', 'type', 'target', 'domain', 'hl', 'authuser']);
  if ([...url.searchParams.keys()].some(key => !allowed.has(key)) ||
      ['target', 'domain'].some(key => url.searchParams.getAll(key).length > 1 || url.searchParams.get(key)) ||
      ['hl', 'authuser'].some(key => url.searchParams.getAll(key).length > 1) ||
      (url.searchParams.has('authuser') && !/^\d+$/.test(url.searchParams.get('authuser'))) ||
      (url.searchParams.has('hl') && !/^[a-z]{2,3}(?:-[a-zA-Z]{2,4})?$/.test(url.searchParams.get('hl')))) fail('В отчёте обнаружен фильтр или неизвестный параметр.');
  const tables = document.querySelectorAll('table.i3WFpf');
  if (tables.length !== 1) fail('Не удалось однозначно определить таблицу.');
  const table = tables[0];
  const names = [['Сайт', 'Site'], ['Страницы со ссылками на ресурс', 'Linking pages'], ['Страницы назначения', 'Target pages']];
  const headers = [...table.querySelectorAll('thead th')];
  if (headers.length !== 3 || headers.some((header, index) =>
   !names[index].includes(header.getAttribute('data-name')) || header.getAttribute('data-type') !== (index ? 'number' : 'string'))) fail('Неизвестные колонки таблицы.');
  const filterProof = clearFilters(table);
  if (!filterProof.clear) fail('Состояние фильтров не подтверждено.');
  const seen = new Set();
  const rows = [...table.querySelectorAll('tbody tr')].map(row => {
   const cells = [...row.querySelectorAll('td')];
   if (cells.length !== 3) fail('Неизвестная строка таблицы.');
   const domain = cells[0].getAttribute('data-string-value');
   if (!domain || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]+$/i.test(domain) || seen.has(domain.toLowerCase())) fail('Неизвестный или повторяющийся домен.');
   seen.add(domain.toLowerCase());
   const numbers = cells.slice(1).map(cell => {
    const raw = cell.getAttribute('data-numeric-value');
    if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) fail('Неизвестное числовое значение.');
    return Number(raw);
   });
   return {domain: domain.toLowerCase(), links: numbers[0], targetPages: numbers[1]};
  });
  const sibling = table.closest('div.xIJlRd');
  const pagination = sibling?.querySelector('.UwdJ1c');
  const text = pagination?.textContent.replace(/\s+/g, ' ').trim() || '';
  const match = text.match(/(?:^|\s)(\d+)\s*[–—-]\s*(\d+)\s*(?:из|of)\s*(\d+)(?:\s|$)/i);
  const controls = sibling ? [...sibling.querySelectorAll('[data-paginate]')] : [];
  const values = match?.slice(1).map(Number);
  const validRange = !!values && values.every(Number.isSafeInteger) && (values[2] ? values[0] >= 1 : values[0] === 0) &&
   values[1] >= values[0] && values[1] <= values[2] && rows.length === (values[2] ? values[1] - values[0] + 1 : 0);
  const knownControls = validRange && controls.length === 2 &&
   controls[0].getAttribute('aria-disabled') === String(values[0] <= 1) &&
   controls[1].getAttribute('aria-disabled') === String(values[1] === values[2]);
  if (!knownControls) fail('Диапазон строк или пагинация неизвестны.');
  const complete = values[0] === (values[2] ? 1 : 0) && values[1] === values[2];
  return {url: url.href, resourceId, rows, coverage: {start: values[0], end: values[1], total: values[2], complete}, filters: filterProof};
 }
 function clearFilters(table) {
  // An explicit known toolbar is required; absence of filter chips alone is not proof.
  const section = table.closest('div.xIJlRd');
  const toolbars = section?.querySelectorAll('div.c1UqTd div.kHsG div.Y9Rb7');
  if (toolbars?.length !== 1) return {clear: false, evidence: 'known-toolbar'};
  const toolbar = toolbars[0], filters = toolbar.querySelectorAll('div[jsname="BbxQOb"].Qi0ZXd');
  const buttons = toolbar.querySelectorAll('[role="button"][jsname="mghfO"]');
  const empty = filters.length === 1 && !filters[0].children.length && !filters[0].textContent.trim() &&
   getComputedStyle(filters[0]).display === 'none';
  return {clear: empty && buttons.length === 1 && buttons[0].getAttribute('aria-expanded') === 'false', evidence: 'known-toolbar'};
 }
 function elapsed(iso) {
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000));
  if (days < 30) return `${days} д`;
  if (days < 365) return `${Math.floor(days / 30)} м`;
  return `${Math.floor(days / 365)} г`;
 }
 function cleanup() { document.querySelectorAll(`[${marker}]`).forEach(node => node.remove()); }
 let generation = 0, timer, lastKey = '', applying = false, cellSequence = 0;
 const cellIds = new WeakMap();
 async function annotate() {
  const current = ++generation, href = location.href, id = resource(href);
  cleanup();
  if (!id || !chrome?.runtime?.sendMessage) return;
  try {
   const result = await chrome.runtime.sendMessage({type: 'seoGscHistory', action: 'pageState', resourceId: id});
   if (current !== generation || location.href !== href || !result?.ok) return;
   const state = result.result;
   if (state?.resourceId !== id || !Array.isArray(state.summary?.domains)) return;
   const tables = document.querySelectorAll('table.i3WFpf');
   if (tables.length !== 1) return;
   const entries = new Map(state.summary.domains.map(item => [item.domain, item]));
   const hasBaseline = (state.summary.measurementCount || 0) > 0;
   applying = true;
   for (const cell of tables[0].querySelectorAll('tbody tr td:first-child[data-string-value]')) {
    const item = entries.get(cell.getAttribute('data-string-value').toLowerCase());
    if (!item && !hasBaseline) continue;
    const note = document.createElement('span'); note.setAttribute(marker, '');
    const delta = Number.isSafeInteger(item?.deltaLinks) ? `${item.deltaLinks > 0 ? '+' : ''}${item.deltaLinks}` : '—';
    const cells = [...cell.parentElement.querySelectorAll('td')];
    const live = cells.slice(1).map(value => value.getAttribute('data-numeric-value'));
    const knownCounts = live.length === 2 && live.every(value => /^\d+$/.test(value || '') && Number.isSafeInteger(Number(value)));
    const unsaved = !!item && knownCounts && (Number(live[0]) !== item.links || Number(live[1]) !== item.targetPages);
    const firstSeen = item?.firstSeenAt && Number.isFinite(Date.parse(item.firstSeenAt)) ?
     ` · сохранено ${new Date(item.firstSeenAt).toLocaleDateString('ru-RU')} (${elapsed(item.firstSeenAt)})` : '';
    if (!item || item.status === 'new') {
     const badge = document.createElement('span');
     badge.textContent = 'NEW';
     badge.style.cssText = 'display:inline-block;vertical-align:middle;margin:0 4px;padding:1px 5px;border:1px solid #a6c945;border-radius:9px;background:#ccff5f;color:#23420b;font:600 10px/1.4 Arial,sans-serif;white-space:nowrap';
     note.append(badge);
    }
    note.append(document.createTextNode(`${firstSeen}${item ? ` · Δ ${delta}` : ' · ещё не сохранён'}${unsaved ? ' · не сохранено' : ''}`));
    note.title = !item ? 'NEW: домен отсутствует в нашей сохранённой истории. Текущая строка ещё не сохранена.' :
     'Первое наблюдение в нашей сохранённой истории; не дата обхода Google. NEW сохраняется в течение дня первого наблюдения после исходного снимка. Δ сравнивает накопленный день по Москве с предыдущим сохранённым днём, а не с предыдущим нажатием.';
    if (unsaved) note.title += ` Есть несохранённые изменения: на странице ${live[0]} страниц со ссылками и ${live[1]} страниц назначения; сохранено ${item.links} и ${item.targetPages}. Δ относится к сохранённому сравнению дней.`;
    note.style.cssText = 'font:11px/1.4 Arial,sans-serif;color:#5c6654;white-space:normal';
    cell.append(note);
   }
  } catch { /* Existing page stays usable when extension storage is unavailable. */ }
  finally { applying = false; }
 }
 function key() {
  return location.href + '\n' + [...document.querySelectorAll('table.i3WFpf td')].map(cell => {
   if (!cellIds.has(cell)) cellIds.set(cell, ++cellSequence);
   return `${cellIds.get(cell)}:${cell.getAttribute('data-string-value') || cell.getAttribute('data-numeric-value') || ''}`;
  }).join('|');
 }
 function schedule() {
  if (applying) return;
  const next = key();
  if (next === lastKey) return;
  lastKey = next; clearTimeout(timer); timer = setTimeout(annotate, 150);
 }
 globalThis.SeoGscPage = {page, resource, snapshot, annotate, elapsed};
 globalThis.globalSeoGscPage = globalThis.SeoGscPage;
 if (globalThis.chrome?.runtime?.id && globalThis.MutationObserver && document.documentElement) {
  new MutationObserver(schedule).observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-string-value', 'data-numeric-value']});
  setInterval(schedule, 1000);
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'seoGscRefresh') void annotate(); });
  schedule();
 }
})();
