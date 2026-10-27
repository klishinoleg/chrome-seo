'use strict';
const $ = (id) => document.getElementById(id);
let snapshot = null;
let linksSaveBusy = false;
let analysisGeneration = 0;
let membershipPageUrl = null;
let membershipTabId = null;
let membershipListsReady = false;
let listsGeneration = 0;
function normalizedHostname(value) {
 try {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)) return null;
  return url.hostname.toLowerCase().replace(/\.+$/,'').replace(/^www\./,'') || null;
 } catch { return null; }
}
function renderInList() {
 const target=$('in-list-status');
 if(!target) return;
 const hostname=normalizedHostname(membershipPageUrl);
 const list=membershipListsReady && listsState?.data.lists.find(x=>x.id===listsState.selectedListId);
 let state='unknown';
 let title=!hostname ? 'Обновите анализ доступной HTTP(S)-страницы.' : !membershipListsReady ? 'Данные списков недоступны или обновляются.' : 'Выберите текущий список в LISTS.';
 if(hostname && list) {
  const present=list.items.some(item=>normalizedHostname(item.url)===hostname);
  state=present ? 'present' : 'absent';
  title='Домен '+hostname+(present ? ' найден' : ' не найден')+' в списке «'+list.name+'». Сравниваются домены URL; www и завершающая точка не учитываются.';
 }
 target.dataset.state=state;
 target.title=title;
 target.setAttribute('aria-label','IN LIST. '+title);
}
function invalidateMembershipPage() {
 membershipPageUrl=null;
 renderInList();
}
const indexabilityCaveat = 'Наличие URL в индексе поисковых систем не проверено. HTTP-заголовки получены повторным HEAD-запросом, а не из ответа навигации.';
function renderIndexability(data, signals) {
 const target=$('indexability-status');
 if(!target) return;
 let result={state:'partial',label:'Проверка неполная',reasons:['Сетевые сигналы ещё не получены.']};
 if(signals && globalThis.SeoIndexability?.evaluate) {
  try { result=globalThis.SeoIndexability.evaluate(data,signals); }
  catch { result.reasons=['Не удалось оценить правила индексации.']; }
 }
 target.textContent=result.label;
 target.className=`indexability ${result.state}`;
 target.title=[...result.reasons,indexabilityCaveat].join('\n');
 target.setAttribute('aria-label',`${result.label}. ${target.title}`);
}
async function collectIndexability(data, tabId, generation) {
 const isCurrent=()=>generation===analysisGeneration && snapshot?.url===data.url;
 try {
  if(!globalThis.SeoIndexability?.collect) throw new Error('Модуль проверки недоступен.');
  const [active]=await chrome.tabs.query({active:true,currentWindow:true});
  if(active?.id!==tabId || active.url!==data.url) throw new Error('Активная страница изменилась; обновите анализ.');
  const results=await chrome.scripting.executeScript({target:{tabId},func:globalThis.SeoIndexability.collect});
  const signals=results[0]?.result;
  if(!signals || signals.url!==data.url) throw new Error('Страница изменилась во время проверки; обновите анализ.');
  if(isCurrent()) renderIndexability(data,signals);
 } catch(error) {
  if(!isCurrent()) return;
  renderIndexability(data,null);
  const target=$('indexability-status');
  if(target) {target.title=`${error.message || error}\n${indexabilityCaveat}`;target.setAttribute('aria-label',`${target.textContent}. ${target.title}`);}
 }
}
async function analyzePage() {
 const generation=++analysisGeneration;
 invalidateMembershipPage();
 renderIndexability(snapshot,null);
 let tabId;
 const data=await invoke('analyze',undefined,tab=>{tabId=tab.id;});
 if(generation!==analysisGeneration) return false;
 const [active]=await chrome.tabs.query({active:true,currentWindow:true});
 if(generation!==analysisGeneration) return false;
 if(active?.id!==tabId || active.url!==data?.url || !normalizedHostname(data?.url)) throw new Error('Активная страница изменилась; обновите анализ.');
 membershipPageUrl=data.url;
 membershipTabId=tabId;
 snapshot=data;
 renderInList();
 $('page').textContent=data.url;
 $('page').title=data.url;
 if($('copy-page-url')) $('copy-page-url').disabled=false;
 renderMeta(data); renderMicro(data.micro); renderLinks();
 renderIndexability(data,null);
 void collectIndexability(data,tabId,generation);
 return true;
}
const status = (message = '') => { $('status').textContent = message; };
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text); if (className) node.className = className; return node; }
function table(headers, rows) { const wrap = element('div', undefined, 'table-wrap'); const t = element('table'); const head = element('tr'); headers.forEach(x => head.append(element('th', x))); const thead = element('thead'); thead.append(head); t.append(thead); const body = element('tbody'); rows.forEach(values => { const tr = element('tr'); values.forEach(value => { const td = element('td'); if (value instanceof Node) td.append(value); else td.textContent = String(value ?? '—'); tr.append(td); }); body.append(tr); }); t.append(body); wrap.append(t); if (!rows.length) wrap.append(element('p', 'Не найдено', 'empty')); return wrap; }
function section(target, title, headers, rows) { target.append(element('h2', title), table(headers, rows)); }
async function invoke(method, input, onTab) { const [tab] = await chrome.tabs.query({active:true,currentWindow:true}); if (!tab?.id || !/^https?:/i.test(tab.url || '')) throw new Error('Откройте обычную HTTP(S)-страницу. Внутренние страницы Chrome и магазин расширений недоступны.'); if(onTab) onTab(tab); await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']}); const result = await chrome.scripting.executeScript({target:{tabId:tab.id},func:(name,arg) => globalThis.__chromeSeo[name](arg),args:[method,input ?? '']}); return result[0]?.result; }
async function action(work) { status('Выполняется…'); try { await work(); } catch (error) { status(`Не удалось выполнить: ${error.message || error}. Проверьте, доступна ли страница для расширений.`); } }
function renderMeta(data) { const panel = $('meta'); panel.replaceChildren(element('h1','META / документ')); const metrics=element('div',undefined,'metrics'); [['H1',data.headings.filter(x=>x.tag.toLowerCase()==='h1').length],['Слов',data.wordCount],['Внешних ссылок',data.links.length],['Без ALT',data.images.filter(x=>!x.hasAlt).length]].forEach(([label,value])=>{const item=element('div',undefined,'metric');item.append(element('b',value),element('span',label));metrics.append(item);}); panel.append(metrics); panel.append(table(['Параметр','Значение'],[['URL',data.url],['Домен',data.hostname],[`Title · ${data.title.length} зн.`,data.title],[`Description · ${data.description.length} зн.`,data.description],['Canonical',data.canonical],['Robots',data.robots],['Язык',data.lang],['Слов в видимом тексте',data.wordCount],['Robots ограничивает ссылки',data.pageNofollow ? 'Да' : 'Нет']])); section(panel,'Заголовки H1–H6',['Тег','Текст'],data.headings.map(x=>[x.tag,x.text])); section(panel,'Open Graph',['Свойство','Содержимое'],data.openGraph.map(x=>[x.property,x.content])); section(panel,`Изображения / ${data.images.length}`,['Источник','ALT','Атрибут ALT'],data.images.map(x=>[x.src,x.alt,x.hasAlt?'Есть':'Отсутствует'])); }
function renderMicro(data) { const panel=$('micro'); panel.replaceChildren(element('h1','Микроразметка')); panel.append(element('h2',`JSON-LD / ${data.jsonLd.length}`)); if (!data.jsonLd.length) panel.append(element('p','Не найдено','empty')); data.jsonLd.forEach((x,i)=>{panel.append(element('h2',`Блок ${i+1}`)); if(x.error) panel.append(element('p',`Ошибка JSON: ${x.error}`,'bad')); panel.append(element('pre', x.error ? x.raw : JSON.stringify(x.data,null,2)));}); section(panel,'Microdata',['Тип','ID','Свойства'],data.microdata.map(x=>[x.type,x.id,x.properties.map(p=>`${p.name}: ${p.value}`).join('\n')])); section(panel,'RDFa',['Тег','about','typeof','property','content'],data.rdfa.map(x=>[x.tag,x.about,x.typeof,x.property,x.content])); }
function matchingLinks(data) { const filter=$('links-domain').value.trim().toLowerCase(); return data.links.filter(x=>x.domain.toLowerCase().includes(filter)); }
function renderLinksSave() { const list=listsState?.data.lists.find(x=>x.id===listsState.selectedListId); const label=list?.name || 'Выберите список в LISTS'; $('links-current-list').textContent=label; $('links-current-list').title=label; $('save-links-page').disabled=linksSaveBusy || !list || !snapshot || !matchingLinks(snapshot).length; }
function renderLinks() { if(!snapshot) return; const links=matchingLinks(snapshot); renderLinksSave(); $('link-count').textContent=`${links.length} / ${snapshot.links.length}`; const rows=links.map(x=>{const marker=element('span',x.restricted?'Ограничена':'Без ограничений',x.restricted?'bad':'good');return [marker,x.text || '(без текста)',x.domain,x.url,x.rel || '—'];}); $('link-results').replaceChildren(table(['Статус','Текст','Домен','URL','rel'],rows)); }
async function refresh() { await action(async()=>{if(await analyzePage()) status('');}); }
async function count() { const data=await invoke('keywords',$('keywords').value); const headers=['Слово','Всего','Title','Meta','H1','H2','H3','H4','H5','H6','Body','P','A','Other']; const names=['total','title','meta','h1','h2','h3','h4','h5','h6','body','p','a','other']; const rows=data.words.map(x=>{const name=element('span'); const chip=element('span',undefined,'chip'); chip.style.backgroundColor=x.color; name.append(chip,document.createTextNode(x.word));return [name,...names.map(n=>x[n])];}); $('key-results').replaceChildren(element('p',`Слов в видимом тексте: ${data.wordCount}`,'hint'),table(headers,rows)); }
function highlightResult(result) { status(result.supported ? `Подсвечено совпадений: ${result.count}` : (result.message || 'Этот браузер не поддерживает CSS Custom Highlight API.')); }
async function saveSearch() { await chrome.storage.local.set({searchTargetDomain:$('search-domain').value.trim(),searchQuery:$('search-query').value}); }
async function search(engine,mode='query') { await Promise.all(['search-domain','search-query'].map(id=>globalThis.SeoInputHistory.remember(id))); await saveSearch(); const domain=$('search-domain').value.trim().replace(/^https?:\/\//i,'').split('/')[0]; const query=$('search-query').value.trim(); let text=query; if(mode==='site') {if(!domain) throw new Error('Укажите целевой домен'); text=`site:${domain}${query?' '+query:''}`;} if(mode==='url') {if(!snapshot?.url) throw new Error('Сначала откройте доступную страницу и обновите анализ'); text=`site:${snapshot.url}${query?' '+query:''}`;} if(!text) throw new Error('Введите поисковый запрос'); const url=engine==='google'?`https://www.google.com/search?q=${encodeURIComponent(text)}`:`https://yandex.ru/search/?text=${encodeURIComponent(text)}`; await chrome.tabs.create({url}); status('Поиск открыт в новой вкладке.'); }
const inspectorTabIds = new Set(['meta','keys','micro','links','search','lists','ai','settings']);
let inspectorTabSelected = false;
let inspectorTabSave = Promise.resolve();
function selectInspectorTab(tabId) {
 const selected = inspectorTabIds.has(tabId) ? tabId : 'meta';
 document.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle('active',button.dataset.tab===selected));
 document.querySelectorAll('.panel').forEach(panel=>panel.classList.toggle('active',panel.id===selected));
}
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{
 const tabId=button.dataset.tab;
 if(!inspectorTabIds.has(tabId)) return;
 inspectorTabSelected=true;
 selectInspectorTab(tabId);
 // Serialize writes so a slower earlier click cannot replace the latest choice.
 inspectorTabSave=inspectorTabSave.then(()=>chrome.storage.local.set({lastInspectorTab:tabId})).catch(()=>{});
}));
$('refresh').addEventListener('click',refresh);
$('copy-page-url')?.addEventListener('click',async()=>{
 const url=snapshot?.url;
 if(!url) {status('Сначала обновите анализ страницы.');return;}
 try {await navigator.clipboard.writeText(url);status('Полный URL скопирован.');}
 catch {status('Не удалось скопировать URL. Повторите попытку или скопируйте его из адресной строки.');}
});
$('count').addEventListener('click',()=>action(async()=>{await count();status('');}));
$('highlight-keys').addEventListener('click',()=>action(async()=>{await count();highlightResult(await invoke('highlightKeywords',$('keywords').value));}));
$('highlight-links').addEventListener('click',()=>action(async()=>{await globalThis.SeoInputHistory.remember('links-domain');highlightResult(await invoke('highlightLinks',$('links-domain').value.trim()));}));
document.querySelectorAll('.clear').forEach(button=>button.addEventListener('click',()=>action(async()=>{await invoke('clearHighlights');status('Подсветка очищена.');})));
$('links-domain').addEventListener('input',()=>{renderLinks();chrome.storage.local.set({linksDomain:$('links-domain').value}).catch(error=>status(error.message));});
['search-domain','search-query'].forEach(id=>['input','change'].forEach(event=>$(id).addEventListener(event,()=>saveSearch().catch(error=>status(error.message)))));
for(const engine of ['google','yandex']) { $(engine).addEventListener('click',()=>action(()=>search(engine))); $(`${engine}-site`).addEventListener('click',()=>action(()=>search(engine,'site'))); $(`${engine}-url`).addEventListener('click',()=>action(()=>search(engine,'url'))); }
(async()=>{try {const saved=await chrome.storage.local.get(['linksDomain','searchTargetDomain','searchQuery','lastInspectorTab']); if(!inspectorTabSelected) selectInspectorTab(saved.lastInspectorTab); $('links-domain').value=saved.linksDomain || ''; $('search-domain').value=saved.searchTargetDomain || ''; $('search-query').value=saved.searchQuery || ''; await globalThis.SeoInputHistory.init();}catch(error){status(error.message);} await refresh();})();



let listsState = null;
const recovery=seoListsRecovery;
for(const id of ['list-name','list-comment','list-tags']) {$(id).value=recovery.drafts[id] || '';$(id).addEventListener('input',()=>{try{recovery.save();}catch{}});}
recovery.capture(()=>{for(const id of ['list-name','list-comment','list-tags']) recovery.drafts[id]=$(id).value;});
const parseTags = value => { const seen=new Set();return value.split(',').map(x=>x.trim()).filter(x=>{const key=x.toLowerCase();if(!x || seen.has(key))return false;seen.add(key);return true;}); };
async function listsCall(action, payload = {}) {
 const generation=++listsGeneration;
 membershipListsReady=false;
 renderInList();
 try {
  const result=await chrome.runtime.sendMessage({type:'seoLists',action,...payload});
  if(!result?.ok || !Array.isArray(result.state?.data?.lists)) throw new Error(result?.error || 'Хранилище недоступно');
  if(generation===listsGeneration) {listsState=result.state;membershipListsReady=true;renderLists();}
  return result.state;
 } catch(error) {
  if(generation===listsGeneration) {membershipListsReady=false;renderInList();}
  throw error;
 }
}
function renderLists() { renderInList(); renderLinksSave(); if (!listsState) return; const select = $('list-select'); select.replaceChildren(); listsState.data.lists.forEach(list => { const option = element('option', list.name); option.value = list.id; select.append(option); }); select.value = listsState.selectedListId || ''; const list = listsState.data.lists.find(x => x.id === select.value); $('save-list-page').disabled = !list; $('list-tag-options').replaceChildren(); $('list-tag-suggestions').replaceChildren(); (list?.tags || []).forEach(tag => { const option = element('option'); option.value = tag; $('list-tag-options').append(option); const button = element('button',tag); button.addEventListener('click',()=>{const tags=parseTags($('list-tags').value);if(!tags.some(x=>x.toLowerCase()===tag.toLowerCase())) tags.push(tag);$('list-tags').value=tags.join(', ');try{recovery.save();}catch{}}); $('list-tag-suggestions').append(button); }); const sync=listsState.sync; $('list-sync').textContent = sync.pending ? `JSON: ожидает синхронизации. ${sync.error || 'Подключите папку в библиотеке.'}` : sync.connected ? `JSON: ${sync.directoryName || 'папка'} · синхронизировано` : 'Хранится в Chrome. Папку JSON можно подключить в библиотеке.'; }
async function listsAction(work) { try { await work(); } catch(error) { recovery.explain(error);$('list-status').textContent=error.message || String(error); } }
$('create-list').addEventListener('click',()=>listsAction(async()=>{await listsCall('createList',{name:$('list-name').value.trim()});$('list-name').value='';recovery.save();$('list-status').textContent='Список создан.';}));
$('list-select').addEventListener('change',()=>listsAction(()=>listsCall('selectList',{listId:$('list-select').value})));
$('save-list-page').addEventListener('click',()=>listsAction(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true}); if(!/^https?:\/\//i.test(tab?.url || '')) throw new Error('Для сохранения откройте HTTP(S)-страницу.'); await listsCall('get'); await listsCall('addItem',{listId:listsState.selectedListId,url:tab.url,title:tab.title || '',comment:$('list-comment').value,tags:parseTags($('list-tags').value)});$('list-comment').value='';$('list-tags').value='';recovery.save();$('list-status').textContent='Страница сохранена в Chrome.';}));
$('open-library').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('library.html')}));
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local' && ['seoListsData','currentListId','seoListsSync'].some(key=>key in changes)) listsAction(()=>listsCall('get'));});
listsAction(()=>listsCall('get'));

function linksTags(data, links) {
 const tags=new Set();
 let follow=false;
 for(const link of links) {
  const tokens=(link.rel || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  tokens.filter(token=>token!=='follow').forEach(token=>tags.add(token));
  if(!tokens.some(token=>['nofollow','ugc','sponsored'].includes(token))) follow=true;
 }
 if(data.pageNofollow) tags.add('nofollow');
 else if(follow) tags.add('follow');
 return [...tags];
}
$('save-links-page').addEventListener('click',async()=>{
 if(linksSaveBusy) return;
 linksSaveBusy=true;
 $('save-links-page').disabled=true;
 status('Сохранение страницы…');
 try {
  await globalThis.SeoInputHistory.remember('links-domain');
  if(!await analyzePage()) throw new Error('Анализ обновлён другим действием; повторите сохранение.');
  const state=await listsCall('get');
  const list=state.data.lists.find(x=>x.id===state.selectedListId);
  if(!list) throw new Error('Выберите список в LISTS');
  const links=matchingLinks(snapshot);
  if(!links.length) throw new Error('Нет внешних ссылок по текущему фильтру.');
  if(!/^https?:\/\//i.test(snapshot.url || '')) throw new Error('Для сохранения откройте HTTP(S)-страницу.');
  await listsCall('addItem',{listId:list.id,url:snapshot.url,title:snapshot.title || '',comment:'',tags:linksTags(snapshot,links)});
  status(`Страница сохранена в «${list.name}».`);
 } catch(error) {
  recovery.explain(error);
  status(`Не удалось сохранить: ${error.message || error}`);
 } finally {
  linksSaveBusy=false;
  renderLinksSave();
 }
});

// Tab events are optional in embedded browser bridges.
chrome.tabs.onActivated?.addListener(()=>{++analysisGeneration;membershipTabId=null;invalidateMembershipPage();void refresh();});
chrome.tabs.onUpdated?.addListener((tabId,change)=>{
 if(tabId!==membershipTabId && membershipTabId!==null) return;
 if(change.url || change.status==='loading') {++analysisGeneration;invalidateMembershipPage();}
 if(change.status==='complete') void refresh();
});

$('open-competitors').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('competitors.html')}));
