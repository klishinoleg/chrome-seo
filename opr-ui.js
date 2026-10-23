'use strict';
(() => {
 const el=id=>document.getElementById(id);
 let busy=false,settingsBusy=false,revision=0,observedTab=null;
 const say=text=>{el('opr-status').textContent=text;};
 function invalidate(){revision++;el('opr-metric').textContent='OPR —';el('opr-metric').title='Open PageRank · проверка только по кнопке';}
 function recovery(){el('opr-reload').hidden=false;return new Error('Обновите расширение целиком и откройте снова. После обновления введите ключ повторно. Удалять расширение не нужно.');}
 async function rpc(action,values={}) {
  const isKe=['getCreditSettings','saveCreditSettings','deleteCreditKey','credits'].includes(action);
  const recover=()=>{if(!isKe) return recovery();el('ke-reload').hidden=false;return new Error('Обновите расширение целиком и откройте снова. Затем введите ключ KE повторно.');};
  const permission=isKe?'https://api.keywordseverywhere.com/*':'https://openpagerank.keywordseverywhere.com/*';
  if(!chrome.runtime.getManifest().host_permissions?.includes(permission)) throw recover();
  let response;
  try{response=await chrome.runtime.sendMessage({type:'seoOpenPageRank',action,...values});}
  catch{throw recover();}
  if(!response || typeof response.ok!=='boolean' || (response.ok && !response.result)) throw recover();
  if(!response.ok) throw new Error(response.error || 'OPR недоступен.');
  return response.result;
 }
 async function active(){const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});if(!tab?.id || !/^https?:\/\//i.test(tab.url || '')) throw new Error('Откройте HTTP(S)-страницу для проверки OPR.');return {id:tab.id,hostname:new URL(tab.url).hostname.toLowerCase().replace(/\.$/,'')};}
 function settingsStatus(result){say(result.hasKey?'Ключ Open PageRank сохранён локально.':'Добавьте отдельный ключ Open PageRank.');el('opr-reload').hidden=true;}
 async function setting(action){
  if(settingsBusy) return;settingsBusy=true;invalidate();el('opr-save').disabled=el('opr-delete').disabled=true;
  const key=el('opr-key').value;el('opr-key').value='';
  try{settingsStatus(await rpc(action,action==='saveSettings'?{key}:{}));invalidate();}
  catch(error){say(error.message);}
  finally{settingsBusy=false;el('opr-save').disabled=el('opr-delete').disabled=false;el('opr-key').value='';}
 }
 el('opr-save').addEventListener('click',()=>setting('saveSettings'));
 el('opr-delete').addEventListener('click',()=>setting('deleteKey'));
 el('opr-reload').addEventListener('click',()=>{el('opr-key').value='';try{chrome.runtime.reload();}catch{say('Откройте chrome://extensions и обновите расширение вручную.');}});
 el('opr-check').addEventListener('click',async()=>{
  if(busy) return;busy=true;el('opr-check').disabled=true;invalidate();const request=revision;
  try{
   const target=await active();observedTab=target.id;
   if(request!==revision) return;
   const result=await rpc('check',{hostname:target.hostname});
   const current=await active();
   if(request!==revision || current.id!==target.id || current.hostname!==target.hostname) return;
   el('opr-metric').textContent=result.found?`OPR ${result.score}`:'OPR —';
   el('opr-metric').title=`Источник: Keywords Everywhere Open PageRank\nДомен запроса: ${target.hostname}\nДата: ${result.asOf}\nRank: ${result.rank ?? 'нет данных'}${result.found?'':'\nНет данных для этого хоста'}${target.hostname.startsWith('www.')?'\nПровайдер считает www частью основного домена.':''}`;
   say(result.found?'OPR проверен.':'OPR: нет данных для текущего хоста.');
  }catch(error){if(request===revision){say(error.message);el('opr-metric').textContent='OPR !';el('opr-metric').title=error.message;}}
  finally{busy=false;el('opr-check').disabled=false;}
 });
 chrome.tabs.onUpdated?.addListener((id,change)=>{if((observedTab===null || id===observedTab) && (change.url || change.status==='loading')) invalidate();});
 chrome.tabs.onActivated?.addListener(()=>{observedTab=null;invalidate();});
 el('refresh')?.addEventListener('click',invalidate);
 window.addEventListener('pagehide',()=>{el('opr-key').value='';el('ke-key').value='';});
 let creditBusy=false,creditSettingsBusy=false,creditRevision=0;
 const creditSay=text=>{el('ke-status').textContent=text;};
 const clearCredit=()=>{creditRevision++;el('ke-credits').textContent='KE — кр.';el('ke-credits').title='Баланс KE проверяется только по кнопке';};
 function creditSettings(result){creditSay(result.hasKey?'Общий ключ KE сохранён локально.':'Добавьте общий ключ Keywords Everywhere.');el('ke-reload').hidden=true;}
 async function creditSetting(action){
  if(creditSettingsBusy) return;creditSettingsBusy=true;el('ke-save').disabled=el('ke-delete').disabled=true;clearCredit();
  const key=el('ke-key').value;el('ke-key').value='';
  try{creditSettings(await rpc(action,action==='saveCreditSettings'?{key}:{}));}catch(error){creditSay(error.message);}
  finally{creditSettingsBusy=false;el('ke-save').disabled=el('ke-delete').disabled=false;el('ke-key').value='';}
 }
 el('ke-save').addEventListener('click',()=>creditSetting('saveCreditSettings'));
 el('ke-delete').addEventListener('click',()=>creditSetting('deleteCreditKey'));
 el('ke-reload').addEventListener('click',()=>{el('ke-key').value='';try{chrome.runtime.reload();}catch{creditSay('Откройте chrome://extensions и обновите расширение вручную.');}});
 el('ke-refresh').addEventListener('click',async()=>{
  if(creditBusy || creditSettingsBusy) return;creditBusy=true;el('ke-refresh').disabled=true;const request=creditRevision;
  try{const result=await rpc('credits');if(request!==creditRevision) return;el('ke-credits').textContent=`KE ${result.credits.toLocaleString('ru-RU')} кр.`;el('ke-credits').title=`Keywords Everywhere · баланс кредитов: ${result.credits}\nПроверено: ${new Date().toLocaleString('ru-RU')}`;creditSay('Баланс KE обновлён.');}
  catch(error){if(request===creditRevision){creditSay(error.message);el('ke-credits').textContent='KE !';el('ke-credits').title=error.message;}}
  finally{creditBusy=false;el('ke-refresh').disabled=false;}
 });
 rpc('getCreditSettings').then(creditSettings).catch(error=>creditSay(error.message));
 rpc('getSettings').then(settingsStatus).catch(error=>say(error.message));
})();
