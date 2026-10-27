/* Local highlights and deliberate, persisted search-rank controls. */
(() => {
 'use strict';
 if (!/^\/search\/?$/.test(location.pathname) && !/\/sorry(?:\/|$)|\/showcaptcha|\/captcha|consent/.test(location.pathname) && !document.querySelector('#captcha-form, .CheckboxCaptcha, .SmartCaptcha, form[action*="consent"]')) return;
 const MARK = 'data-seo-lens-result', UI = 'data-seo-lens-search-ui';
 let targetDomain = '', dismissed = false, scheduled, panel, label, controls, state = null, polling = false, sent = '', settle, settleKey = '', settleStarted = 0, collapsed = true;
 const normalizeDomain = value => { try { const raw=String(value || '').trim(); if(!raw)return ''; const url=new URL(raw.includes('://')?raw:`https://${raw}`); return /^https?:$/.test(url.protocol)?url.hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,''):''; } catch{return '';} };
 const destination = anchor => { try { let url=new URL(anchor.href,location.href); if(/^(?:www\.)?google\.(?:com|ru)$/.test(url.hostname)&&url.pathname==='/url')url=new URL(url.searchParams.get('q')||url.searchParams.get('url')||''); return /^https?:$/.test(url.protocol)?url:null; } catch{return null;} };
 const clearMarks=()=>document.querySelectorAll(`[${MARK}]`).forEach(a=>a.removeAttribute(MARK));
 const queueRequest=async(action,values={})=>{const reply=await chrome.runtime.sendMessage({type:'seoAnalysisQueue',action,...values});if(!reply?.ok)throw new Error(reply?.error||'Очередь запросов недоступна');return reply.queries||[];};
 const active=()=>state && ['running','waiting','paused'].includes(state.status);
 async function request(action, values={}) {
  if (!chrome.runtime?.sendMessage) throw new Error('Автопроверка недоступна. Перезагрузите расширение.');
  const reply=await chrome.runtime.sendMessage({type:'seoRankRun',action,...values});
  if(!reply?.ok)throw new Error(reply?.error || 'Автопроверка недоступна.');
  state=reply.state; renderState(); return state;
 }
 function renderState() {
  if(!controls)return;
  controls.start.disabled=!!active(); controls.stop.disabled=!active(); controls.resume.hidden=state?.status!=='paused';
  controls.results.hidden=!(state?.mode==='collect' && (state.reportId || ['paused','stopped','completed'].includes(state.status)));
  if(!state){controls.stop.disabled=true;controls.resume.hidden=true;return;}
  if(state.mode==='collect'){const item=state.queryResults?.[state.queryIndex];const labels={running:'Сбор выдачи',waiting:'Ожидание следующей страницы',paused:'Пауза',completed:'Завершено',stopped:'Остановлено'};const explanations={'Next-page link is unavailable':'Ссылка на следующую страницу недоступна; запрос учтён частично','CAPTCHA requires manual completion':'Пройдите CAPTCHA вручную','Consent requires manual action':'Подтвердите согласие вручную','Results could not be recognized':'Не удалось распознать результаты','No organic results recognized':'Органические результаты не распознаны','Invalid or repeated next-page URL':'Некорректная или повторная ссылка следующей страницы','Stopped by user':'Остановлено пользователем'};controls.status.textContent=`Сбор: ${labels[state.status] || 'Состояние сбора'} · запрос ${Math.min((state.queryIndex || 0)+1,state.queries?.length || 1)}/${state.queries?.length || 1} · ${state.queries?.[state.queryIndex] || ''} · ${item?.count ?? state.resultsSeen ?? 0}/${state.limit} · ${explanations[state.reason] || (state.reason ? 'Проверьте выдачу перед продолжением' : '')}`;return;}
  const found=state.found;
  const statuses={running:'Проверяю выдачу',waiting:'Ожидание следующей страницы',paused:'Пауза',found:'Домен найден','not-found':'Домен не найден в просмотренном диапазоне',stopped:'Остановлено'};
  const reasons={'Stopped by user':'Проверка остановлена','Search tab closed':'Вкладка закрыта','CAPTCHA requires manual completion':'Пройдите CAPTCHA вручную','Consent requires manual action':'Подтвердите согласие вручную','Results could not be recognized':'Не удалось распознать результаты','No organic results recognized':'Органические результаты не распознаны','Next-page link is unavailable':'Ссылка на следующую страницу недоступна','Invalid or repeated next-page URL':'Некорректная или повторная ссылка на следующую страницу','This results page has already been counted':'Эта страница уже учтена','Unexpected page; search URL changed':'Адрес выдачи изменился','Search tab changed; return to the expected results page':'Выдача изменилась; вернитесь на ожидаемую страницу','Could not open the next results page':'Не удалось открыть следующую страницу','Could not open the first results page':'Не удалось открыть первую страницу'};
  const reason=reasons[state.reason] || (state.status==='paused'?'Проверьте открытую выдачу перед продолжением':'');
  controls.status.textContent=found?`Найдено: позиция ${found.position} · страница ${found.page} · место ${found.positionOnPage}`:`${statuses[state.status] || 'Состояние проверки'}${reason?' · '+reason:''} · страница ${state.currentPage || 1} · просмотрено ${state.pagesVisited || 0} стр., ${state.resultsSeen || 0} результатов`;
 }
 function expectedDocument() {
  if(state?.expectedUrl===location.href)return true;
  const kind=globalThis.SeoSerpParser?.snapshot().kind;return kind==='captcha'||kind==='consent';
 }
 function queueSnapshot() {
  clearTimeout(settle);
  if(state?.status!=='running' || !expectedDocument())return;
  const key=`${state.id}:${location.href}`;
  if(sent===key)return;
  if(settleKey!==key){settleKey=key;settleStarted=Date.now();}
  settle=setTimeout(async()=>{
   if(state?.status!=='running'||!expectedDocument()||sent===key)return;
   sent=key;
   try {await request('snapshot',{runId:state.id,snapshot:globalThis.SeoSerpParser.snapshot()});}
   catch(error){if(controls)controls.status.textContent=error.message;}
  },Math.min(500,Math.max(0,5000-(Date.now()-settleStarted))));
 }
 async function poll() {
  if(polling||dismissed)return; polling=true;
  try {await request('getStatus');queueSnapshot();}
  catch(error){if(controls)controls.status.textContent=error.message;}
  finally{polling=false;}
 }
 function makePanel() {
  panel=document.createElement('aside'); panel.setAttribute(UI,''); panel.setAttribute('aria-label','SEO Lens: поиск домена');
  const shadow=panel.attachShadow({mode:'open'}), style=document.createElement('style');
  style.textContent=':host{all:initial;position:fixed;bottom:18px;left:18px;z-index:2147483647}section{width:350px;max-width:85vw;padding:12px;border-radius:10px;background:#151916;color:#ccff5f;box-shadow:0 6px 30px #0004;font:12px/1.5 "Segoe UI",sans-serif}header,.actions{display:flex;gap:6px;align-items:center}header span{flex:1}[hidden]{display:none!important}textarea,select,input{box-sizing:border-box;width:100%;margin:3px 0 6px;padding:5px;background:#fff;color:#151916;border:1px solid #6f8158;border-radius:4px;font:inherit}button{background:transparent;border:1px solid #6f8158;border-radius:5px;color:#ccff5f;padding:4px 8px;font:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:default}button[hidden]{display:none}button:focus-visible,input:focus-visible{outline:2px solid white}label{display:block;color:#e3eadb}p{margin:7px 0 0;overflow-wrap:anywhere}small{color:#b6beb5}';
  const section=document.createElement('section'), header=document.createElement('header'); label=document.createElement('span');
  const button=(id,text)=>{const node=document.createElement('button');node.type='button';node.id=id;node.textContent=text;return node;};
  const close=button('rank-close','×');close.setAttribute('aria-label','Убрать подсветку на этой странице'); header.append(label,close); section.append(header);
  const toggle=button('rank-toggle',collapsed?'Развернуть':'Свернуть');header.insertBefore(toggle,close);const fields=document.createElement('div');section.append(fields);
  const mode=document.createElement('select');mode.id='rank-mode';mode.setAttribute('aria-label','Режим проверки');for(const [value,text]of [['rank','Позиция домена'],['collect','Сбор конкурентов']]){const option=document.createElement('option');option.value=value;option.textContent=text;mode.append(option);}fields.append(mode);
  function input(id,title,value){const lab=document.createElement('label');lab.htmlFor=id;lab.textContent=title;const node=document.createElement('input');node.id=id;node.value=value;fields.append(lab,node);return node;}
  const domain=input('rank-domain','Домен',targetDomain), query=input('rank-query','Запрос',new URL(location.href).searchParams.get(/google\./.test(location.hostname)?'q':'text')||'');
  const queries=document.createElement('textarea');queries.id='rank-queries';queries.rows=4;queries.placeholder='Запросы: один на строку, максимум 20';queries.setAttribute('aria-label','Запросы для сбора');fields.append(queries);const queueHint=document.createElement('small');queueHint.textContent='Общая очередь: максимум 20 запросов, один на строку. Изменения сохраняются после выхода из поля.';fields.append(queueHint);
  const commitQueue=()=>queueRequest('replace',{queries:queries.value.split(/\r?\n/)}).then(list=>{if(shadow.activeElement!==queries)queries.value=list.join('\n');return list;});queries.addEventListener('change',()=>commitQueue().catch(error=>{status.textContent=error.message;}));queries.addEventListener('blur',()=>commitQueue().catch(error=>{status.textContent=error.message;}));queueRequest('get').then(list=>{if(shadow.activeElement!==queries)queries.value=list.join('\n');}).catch(()=>{});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.seoAnalysisQueries&&shadow.activeElement!==queries)queries.value=(changes.seoAnalysisQueries.newValue||[]).join('\n');});
  const limit=document.createElement('select');limit.id='rank-limit';limit.setAttribute('aria-label','Результатов на запрос');for(const n of [30,100]){const o=document.createElement('option');o.value=n;o.textContent=`${n} результатов`;limit.append(o);}fields.append(limit);
  const engine=document.createElement('select');engine.id='rank-engine';engine.setAttribute('aria-label','Поисковая система');for(const name of ['google','yandex']){const o=document.createElement('option');o.value=name;o.textContent=name;engine.append(o);}engine.value=/google\./.test(location.hostname)?'google':'yandex';fields.append(engine);
  function layout(){fields.hidden=collapsed;start.hidden=collapsed;domain.hidden=mode.value==='collect';domain.previousSibling.hidden=domain.hidden;query.hidden=domain.hidden;query.previousSibling.hidden=query.hidden;queries.hidden=mode.value!=='collect';limit.hidden=queries.hidden;engine.hidden=queries.hidden;toggle.textContent=collapsed?'Развернуть':'Свернуть';toggle.setAttribute('aria-expanded',String(!collapsed));}
  toggle.addEventListener('click',()=>{collapsed=!collapsed;layout();chrome.storage.local.set({seoRankCollapsed:collapsed}).catch(()=>{});});mode.addEventListener('change',layout);
  const actions=document.createElement('div');actions.className='actions';const start=button('rank-start','▶ Старт'),stop=button('rank-stop','Стоп'),resume=button('rank-resume','Продолжить');const results=button('rank-results','Результаты');results.hidden=true;actions.append(start,stop,resume,results);section.append(actions);
  const status=document.createElement('p');status.id='rank-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');section.append(status);
  const note=document.createElement('small');note.textContent='Наблюдаемая позиция в персонализированной выдаче · до 10 страниц / 100 результатов';section.append(note);
  controls={domain,query,start,stop,resume,status,results};layout(); shadow.append(style,section);document.documentElement.append(panel);renderState();
  domain.addEventListener('input',()=>{targetDomain=normalizeDomain(domain.value);chrome.storage.local.set({searchTargetDomain:domain.value}).catch(()=>{});scan();});
  query.addEventListener('input',()=>chrome.storage.local.set({searchQuery:query.value}).catch(()=>{}));
  async function command(action){try{if(action==='start'){sent='';if(mode.value==='collect'){const list=await commitQueue();if(!list.length||list.length>20)throw new Error('Введите от 1 до 20 уникальных запросов.');await request(action,{mode:'collect',queries:list,engine:engine.value,limit:Number(limit.value)});}else await request(action,{query:query.value.trim(),targetDomain:normalizeDomain(domain.value)});}else{if(action==='resume')sent='';await request(action,{runId:state?.id});}queueSnapshot();}catch(error){status.textContent=error.message;}}
  results.addEventListener('click',()=>command('openReport'));
  start.addEventListener('click',()=>command('start'));stop.addEventListener('click',()=>command('stop'));resume.addEventListener('click',()=>command('resume'));
  close.addEventListener('click',async()=>{close.disabled=true;try{if(active())await request('stop',{runId:state.id});dismissed=true;clearTimeout(settle);clearMarks();panel.remove();panel=undefined;controls=undefined;}catch(error){status.textContent=error.message;close.disabled=false;}});
 }
 const style=document.createElement('style');style.setAttribute(UI,'');style.textContent=`a[${MARK}]{outline:2px solid #557e00!important;outline-offset:3px!important;background:#e9ffb5!important;color:#203000!important;border-radius:3px!important;box-decoration-break:clone!important;-webkit-box-decoration-break:clone!important}`;document.documentElement.append(style);
 function scan(){if(dismissed){clearMarks();return;}let count=0;for(const anchor of document.querySelectorAll('a[href]')){const host=destination(anchor)?.hostname.toLowerCase().replace(/\.$/,'').replace(/^www\./,'');const match=targetDomain&&(host===targetDomain||host?.endsWith(`.${targetDomain}`));if(match){anchor.setAttribute(MARK,'');count++;}else anchor.removeAttribute(MARK);}if(!panel?.isConnected)makePanel();const text=`SEO LENS · ${targetDomain || 'укажите домен'} · ссылок: ${count}`;if(label.textContent!==text)label.textContent=text;}
 const observer=new MutationObserver(()=>{clearTimeout(scheduled);scheduled=setTimeout(scan,220);queueSnapshot();});observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['href']});
 chrome.storage.local.get(['searchTargetDomain','searchQuery','seoRankCollapsed']).then(settings=>{targetDomain=normalizeDomain(settings.searchTargetDomain);collapsed=settings.seoRankCollapsed!==false;scan();if(settings.searchQuery)controls.query.value=settings.searchQuery;void poll();}).catch(()=>{scan();void poll();});
 chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.searchTargetDomain){targetDomain=normalizeDomain(changes.searchTargetDomain.newValue);dismissed=false;scan();controls.domain.value=changes.searchTargetDomain.newValue||'';}if(changes.searchQuery&&controls)controls.query.value=changes.searchQuery.newValue||'';});
 setInterval(()=>{if(!dismissed && (active() || !state))void poll();},800);
})();
