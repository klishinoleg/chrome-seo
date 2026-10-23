/* Dedicated Open PageRank secret and manual fixed-endpoint requests only. */
(function(root) {
 'use strict';
 const ENDPOINT='https://openpagerank.keywordseverywhere.com/v1/domains/bulk';
 const fail=message=>{throw new Error(message);};
 let database;
 function trusted(sender) {
  const origin=chrome.runtime.getURL('');
  const own=value=>typeof value==='string' && value.startsWith(origin);
  return Boolean(sender && sender.id===chrome.runtime.id && own(sender.url) && (!sender.tab || own(sender.tab.url)));
 }
 function open() {
  if(!database) database=new Promise((resolve,reject)=>{
   const request=indexedDB.open('seoOpenPageRank',1);
   request.onupgradeneeded=()=>request.result.createObjectStore('settings');
   request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();database=undefined;};resolve(request.result);};
   request.onerror=request.onblocked=()=>reject(new Error('Локальное хранилище OPR недоступно.'));
  }).catch(error=>{database=undefined;throw error;});
  return database;
 }
 async function settings(update, slot='key') {
  const db=await open();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction('settings',update?'readwrite':'readonly'), store=tx.objectStore('settings'), request=store.get(slot);
   let key='';
   request.onsuccess=()=>{key=typeof request.result==='string'?request.result:'';if(update){key=update(key);store.put(key,slot);}};
   tx.oncomplete=()=>resolve(key);
   tx.onerror=tx.onabort=()=>reject(new Error('Не удалось прочитать или сохранить ключ OPR.'));
  });
 }
 function hostname(value) {
  if(typeof value!=='string' || value.length>253 || value!==value.trim() || !/^[a-z0-9.-]+$/i.test(value)) fail('Некорректный домен OPR.');
  const host=value.toLowerCase().replace(/\.$/,'');
  if(!host.includes('.') || host.split('.').some(label=>!label || label.length>63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) || /^\d+(?:\.\d+){3}$/.test(host)) fail('Укажите публичное доменное имя HTTP(S)-страницы.');
  return host;
 }
 async function read(response) {
  const limit=100000;
  if(Number(response.headers?.get('content-length'))>limit) fail('Ответ OPR слишком большой.');
  if(response.body?.getReader) {
   const reader=response.body.getReader(), decoder=new TextDecoder(); let bytes=0,text='';
   try {while(true){const chunk=await reader.read();if(chunk.done) break;bytes+=chunk.value.byteLength;if(bytes>limit){await reader.cancel();fail('Ответ OPR слишком большой.');}text+=decoder.decode(chunk.value,{stream:true});}return text+decoder.decode();}
   finally{reader.releaseLock();}
  }
  const text=await response.text();if(text.length>limit) fail('Ответ OPR слишком большой.');return text;
 }
 function parse(data,host) {
  const invalid=()=>fail('OPR вернул некорректные данные.');
  if(!data || typeof data!=='object' || !Array.isArray(data.results) || data.results.length>100 || typeof data.as_of!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.as_of)) invalid();
  let exact=null;
  for(const row of data.results) {
   if(!row || typeof row.domain!=='string' || row.domain.length>253 || (row.hosts!==undefined && (!Array.isArray(row.hosts) || row.hosts.length>100))) invalid();
   for(const item of row.hosts || []) {
    if(!item || typeof item.host!=='string' || item.host.length>253) invalid();
    if(item.host.toLowerCase()===host) {if(exact) invalid();exact=item;}
   }
   if(row.domain.toLowerCase()===host || (host.startsWith('www.') && row.domain.toLowerCase()===host.slice(4))) {if(exact) invalid();exact=row;}
  }
  if(!exact) return {hostname:host,found:false,score:null,rank:null,asOf:data.as_of};
  if(typeof exact.found!=='boolean') invalid();
  if(!exact.found) return {hostname:host,found:false,score:null,rank:null,asOf:data.as_of};
  if(typeof exact.open_page_rank!=='number' || !Number.isFinite(exact.open_page_rank) || exact.open_page_rank<0 || exact.open_page_rank>10 || (exact.rank!==null && (!Number.isSafeInteger(exact.rank) || exact.rank<1))) invalid();
  return {hostname:host,found:true,score:exact.open_page_rank,rank:exact.rank,asOf:data.as_of};
 }
 async function check(value) {
  const host=hostname(value), key=await settings();
  if(!key) fail('Добавьте отдельный ключ Open PageRank в SETTINGS.');
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
  try {
   const response=await fetch(ENDPOINT,{method:'POST',credentials:'omit',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({domains:[host],include_history:false})});
   if(!response.ok) fail(response.status===401?'Ключ OPR не принят. Проверьте его в SETTINGS.':response.status===403?'OPR отклонил доступ. Проверьте IP и настройки аккаунта.':response.status===429?'Достигнут лимит OPR. Повторите проверку позже.':`Ошибка сервиса OPR (HTTP ${response.status}).`);
   let data;try{data=JSON.parse(await read(response));}catch{fail('Не удалось прочитать ответ OPR.');}
   return parse(data,host);
  } catch(error) {
   // Never expose provider bodies, transport error text, or credentials.
   if(error.name==='AbortError') fail('OPR не ответил вовремя. Повторите проверку вручную.');
   if(/^OPR |^Ошибка сервиса OPR|^Ключ OPR|^Достигнут лимит OPR|^Не удалось прочитать ответ OPR/.test(error.message || '')) throw error;
   fail('Не удалось связаться с OPR. Повторите проверку вручную.');
  } finally {clearTimeout(timer);}
 }
 async function credits() {
  const key=await settings(undefined,'keKey');
  if(!key) fail('Добавьте общий ключ Keywords Everywhere в SETTINGS.');
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
  try {
   const response=await fetch('https://api.keywordseverywhere.com/v1/account/credits',{method:'GET',credentials:'omit',redirect:'error',signal:controller.signal,headers:{Authorization:`Bearer ${key}`}});
   if(!response.ok) fail(response.status===401?'Ключ KE не принят. Проверьте его в SETTINGS.':response.status===429?'Достигнут лимит KE. Повторите вручную позже.':`Ошибка сервиса KE (HTTP ${response.status}).`);
   let data;try{data=JSON.parse(await read(response));}catch{fail('Не удалось прочитать ответ KE.');}
   if(!Array.isArray(data) || data.length!==1 || !Number.isSafeInteger(data[0]) || data[0]<0) fail('KE вернул некорректный баланс.');
   return {credits:data[0]};
  } catch(error) {
   if(error.name==='AbortError') fail('KE не ответил вовремя. Повторите вручную.');
   if(/^Ключ KE|^Достигнут лимит KE|^Ошибка сервиса KE|^Не удалось прочитать ответ KE|^KE вернул/.test(error.message || '')) throw error;
   fail('Не удалось связаться с KE. Повторите вручную.');
  } finally {clearTimeout(timer);}
 }
 async function dispatch(message,sender) {
  if(!trusted(sender)) fail('OPR доступен только страницам расширения.');
  switch(message?.action) {
   case 'getCreditSettings': return {hasKey:Boolean(await settings(undefined,'keKey'))};
   case 'saveCreditSettings': {
    if(message.key!==undefined && (typeof message.key!=='string' || message.key.length>512)) fail('Некорректный ключ KE.');
    const key=(message.key || '').trim();if(key && /\s|[^\x21-\x7e]/.test(key)) fail('Некорректный ключ KE.');
    return {hasKey:Boolean(await settings(old=>key || old,'keKey'))};
   }
   case 'deleteCreditKey': await settings(()=>'','keKey');return {hasKey:false};
   case 'credits': return credits();
   case 'getSettings': return {hasKey:Boolean(await settings())};
   case 'saveSettings': {
    if(message.key!==undefined && (typeof message.key!=='string' || message.key.length>512)) fail('Некорректный ключ OPR.');
    const key=(message.key || '').trim();if(key && /\s|[^\x21-\x7e]/.test(key)) fail('Некорректный ключ OPR.');
    return {hasKey:Boolean(await settings(old=>key || old))};
   }
   case 'deleteKey': await settings(()=>'');return {hasKey:false};
   case 'check': return check(message.hostname);
   default: fail('Неизвестная команда OPR.');
  }
 }
 root.SeoOpenPageRank=Object.freeze({dispatch});
})(globalThis);
