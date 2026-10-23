'use strict';
(() => {
 const el = id => document.getElementById(id);
 let page = null, tabId = null, revision = 0, busy = false, loading = false;
 let resultForm = null, suggestions = [], hasKey = false;
 const say = message => { el('ai-status').textContent = message; };
 const selected = () => page?.forms.find(form => form.id === el('ai-form').value) || null;
 const update = () => { el('ai-generate').disabled = busy || loading || !page || !el('ai-task').value.trim(); };
 function recovery() {
  el('deepseek-reload').hidden = false;
  const text = 'Обновите расширение целиком и откройте его снова. После обновления введите ключ повторно; удалять расширение не нужно.';
  el('deepseek-status').textContent = text;
  return new Error(text);
 }
 function invalidate() {
  revision++; suggestions = []; resultForm = null;
  el('ai-comment').value = ''; el('ai-comment').disabled = true;
  el('ai-fields').replaceChildren(); el('ai-copy').disabled = true; el('ai-fill').disabled = true;
  update();
 }
 async function message(action, values = {}) {
  const manifest = chrome.runtime.getManifest?.();
  if (manifest && !manifest.host_permissions?.includes('https://api.deepseek.com/*')) throw recovery();
  let response;
  try { response = await chrome.runtime.sendMessage({type:'seoDeepSeek', action, ...values}); }
  catch (error) {
   if (/receiving end does not exist|could not establish connection|message port closed|extension context invalidated/i.test(error.message || '')) throw recovery();
   throw error;
  }
  if (!response || typeof response.ok !== 'boolean' || (response.ok && !response.result)) throw recovery();
  if (!response?.ok) throw new Error(response?.error || 'DeepSeek недоступен.');
  return response.result;
 }
 async function active() {
  const [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
  if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) throw new Error('Откройте доступную HTTP(S)-страницу.');
  return tab;
 }
 async function snapshot(id) {
  await chrome.scripting.executeScript({target:{tabId:id},files:['page-context.js']});
  const entries = await chrome.scripting.executeScript({target:{tabId:id},func:() => globalThis.__seoAiContext.snapshot()});
  const data = entries[0]?.result;
  if (!data?.url || !Array.isArray(data.forms)) throw new Error('Не удалось прочитать страницу.');
  return data;
 }
 function schema() {
  const form = selected();
  const labels = {text:'текст',email:'электронная почта',url:'ссылка',tel:'телефон',search:'поиск',number:'число',textarea:'сообщение','select-one':'выбор'};
  el('ai-schema').textContent = form ? form.fields.map(field => {
   const choices = field.options.length ? ` · варианты: ${field.options.map(option => option.label).join(', ')}` : '';
   return `${field.label || field.name || 'Поле'}${field.required ? ' *' : ''} · ${labels[field.type] || 'текст'}${choices}`;
  }).join('\n') : 'Форма не выбрана: будет подготовлен только комментарий.';
 }
 function bestForm(forms) {
  const score = form => form.fields.reduce((total, field) => total + (field.type === 'textarea' ? 100 : 0) + (/comment|message|review|contact|комментар|сообщен|отзыв|контакт/i.test(`${field.name} ${field.label}`) ? 50 : 0) + (field.type === 'email' ? 10 : 0) - (field.type === 'search' ? 100 : 0), 0);
  return forms.reduce((best, form) => !best || score(form) > score(best) ? form : best, null);
 }
 el('ai-task').addEventListener('input', () => {
  invalidate();
  chrome.storage.local.set({seoAiTask:el('ai-task').value}).catch(() => say('Не удалось сохранить задание.'));
 });
 el('ai-page-text').addEventListener('input', invalidate);
 el('ai-form').addEventListener('change', () => { invalidate(); schema(); });
 el('ai-load-page').addEventListener('click', async () => {
  if (loading || busy) return;
  loading = true; page = null; invalidate(); el('ai-load-page').disabled = true;
  el('ai-page-text').value = ''; el('ai-page-text').disabled = true;
  el('ai-form').replaceChildren(); el('ai-form').disabled = true; el('ai-source').textContent = ''; el('ai-schema').textContent = '';
  say('Читаю страницу…');
  try {
   const tab = await active(); const data = await snapshot(tab.id); const current = await active();
   if (current.id !== tab.id || current.url !== data.url) throw new Error('Страница изменилась. Загрузите её повторно.');
   page = data; tabId = tab.id;
   el('ai-source').textContent = `${data.title || ''} · ${data.url}`;
   el('ai-page-text').value = data.text || ''; el('ai-page-text').disabled = false;
   const none = document.createElement('option'); none.value = ''; none.textContent = 'Без формы'; el('ai-form').append(none);
   data.forms.forEach(form => { const option = document.createElement('option'); option.value = form.id; option.textContent = form.label || form.id; el('ai-form').append(option); });
   el('ai-form').value = bestForm(data.forms)?.id || '';
   el('ai-form').disabled = false; schema(); say('Проверьте текст и выберите форму перед отправкой.');
  } catch (error) { say(error.message || 'Нет доступа к странице.'); }
  finally { loading = false; el('ai-load-page').disabled = false; update(); }
 });
 el('ai-generate').addEventListener('click', async () => {
  if (busy || loading || !page || !el('ai-task').value.trim()) return;
  invalidate(); const token = revision; const form = selected();
  busy = true; update(); el('ai-load-page').disabled = true; say('DeepSeek готовит ответ…');
  try {
   const current = await active();
   if (current.id !== tabId || current.url !== page.url) throw new Error('Страница изменилась. Загрузите её повторно.');
   const result = await message('generate', {task:el('ai-task').value, context:{url:page.url,title:page.title,text:el('ai-page-text').value,forms:form ? [form] : []}, formId:form?.id || null});
   if (token !== revision) { say('Данные изменились. Отправьте запрос повторно.'); return; }
   el('ai-comment').value = typeof result.comment === 'string' ? result.comment : '';
   el('ai-comment').disabled = false; el('ai-copy').disabled = false;
   resultForm = form;
   for (const field of (Array.isArray(result.fields) ? result.fields : [])) {
    const definition = form?.fields.find(item => item.id === field.id);
    if (!definition || typeof field.value !== 'string' || suggestions.some(item => item.id === field.id)) continue;
    const label = document.createElement('label'); label.textContent = definition.label || definition.name || definition.id;
    const input = document.createElement('textarea'); input.rows = 2; input.value = field.value;
    input.id = `ai-suggestion-${suggestions.length}`; label.htmlFor = input.id;
    suggestions.push({id:field.id,input}); el('ai-fields').append(label,input);
   }
   el('ai-fill').disabled = !suggestions.length; say('Проверьте ответ и поля. Вставка выполняется отдельно.');
  } catch (error) { say(error.message || 'Не удалось получить ответ.'); }
  finally { busy = false; el('ai-load-page').disabled = false; update(); }
 });
 el('ai-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(el('ai-comment').value); say('Комментарий скопирован.'); }
  catch { say('Не удалось скопировать. Выделите комментарий вручную.'); }
 });
 el('ai-fill').addEventListener('click', async () => {
  if (!page || !resultForm || !suggestions.length) return;
  const token = revision; el('ai-fill').disabled = true;
  try {
   const tab = await active();
   if (tab.id !== tabId || tab.url !== page.url) throw new Error('Страница изменилась. Загрузите её повторно.');
   if (token !== revision) throw new Error('Данные изменились. Загрузите страницу повторно.');
   const payload = {contextId:page.contextId,url:page.url,formId:resultForm.id,fields:suggestions.map(item => ({id:item.id,value:item.input.value}))};
   const entries = await chrome.scripting.executeScript({target:{tabId:tab.id},func:(expectedUrl, values) => {
    if (location.href !== expectedUrl) throw new Error('Страница изменилась.');
    return globalThis.__seoAiContext.fill(values);
   },args:[page.url,payload]});
   const result = entries[0]?.result;
   say(`Заполнено: ${Array.isArray(result?.filled) ? result.filled.length : result?.filled ?? 0}. Пропущено: ${Array.isArray(result?.skipped) ? result.skipped.length : result?.skipped ?? 0}. Форма не отправлена.`);
  } catch (error) { invalidate(); say(error.message || 'Не удалось заполнить форму.'); }
  finally { el('ai-fill').disabled = !suggestions.length; }
 });
 async function settings() {
  const result = await message('getSettings');
  hasKey = Boolean(result.hasKey);
  el('deepseek-model').value = result.model || 'deepseek-flash';
  el('deepseek-status').textContent = result.hasKey ? 'Ключ сохранён. Значение скрыто.' : 'Ключ не задан.';
  el('deepseek-delete').disabled = !result.hasKey;
  el('deepseek-reload').hidden = true;
 }
 async function saveSettings(remove) {
  el('deepseek-save').disabled = true; el('deepseek-delete').disabled = true;
  const key = el('deepseek-key').value; el('deepseek-key').value = '';
  try { await message(remove ? 'deleteKey' : 'saveSettings', remove ? {} : {key,model:el('deepseek-model').value}); invalidate(); await settings(); }
  catch (error) { el('deepseek-status').textContent = error.message || 'Не удалось сохранить настройки.'; }
  finally { el('deepseek-save').disabled = false; el('deepseek-delete').disabled = !hasKey; }
 }
 el('deepseek-save').addEventListener('click', () => saveSettings(false));
 el('deepseek-delete').addEventListener('click', () => saveSettings(true));
 el('deepseek-reload').addEventListener('click', () => {
  el('deepseek-key').value = '';
  try { chrome.runtime.reload(); }
  catch { el('deepseek-status').textContent = 'Откройте chrome://extensions, нажмите «Обновить» у SEO / инспектора и откройте окно расширения снова. Затем повторно введите ключ.'; }
 });
 chrome.tabs.onUpdated?.addListener((id, change) => { if (id === tabId && (change.url || change.status === 'loading')) { page = null; invalidate(); say('Страница изменилась. Загрузите её повторно.'); } });
 chrome.tabs.onActivated?.addListener(() => { if (page) { page = null; invalidate(); say('Активная вкладка изменилась. Загрузите страницу повторно.'); } });
 chrome.storage.local.get(['seoAiTask']).then(data => { if (!el('ai-task').value) el('ai-task').value = data.seoAiTask || ''; update(); }).catch(() => say('Не удалось загрузить сохранённое задание.'));
 settings().catch(error => { el('deepseek-status').textContent = error.message || 'Настройки недоступны.'; });
})();
