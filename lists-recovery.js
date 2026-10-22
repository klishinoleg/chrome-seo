'use strict';
// UI drafts only: authoritative lists and selection remain in the worker store.
globalThis.seoListsRecovery = (function () {
 const key='seoListsUiDrafts:'+(document.getElementById('new-name')?'library':'popup');
 let drafts={};
 try {
  const saved=JSON.parse(localStorage.getItem(key) || '{}');
  if(saved && typeof saved==='object' && !Array.isArray(saved)) {
   for(const name of ['libraryName','list-name','list-comment','list-tags']) if(typeof saved[name]==='string')drafts[name]=saved[name];
   if(saved.rows && typeof saved.rows==='object' && !Array.isArray(saved.rows)) {
    drafts.rows={};
    for(const [id,row] of Object.entries(saved.rows)) if(row && typeof row==='object' && typeof row.comment==='string' && typeof row.tags==='string')Object.defineProperty(drafts.rows,id,{value:{comment:row.comment,tags:row.tags},enumerable:true,writable:true,configurable:true});
   }
  }
 } catch {}
 const panel=document.createElement('div');panel.hidden=true;panel.setAttribute('role','alert');
 const text=document.createElement('p');const restart=document.createElement('button');restart.id='restart-extension';restart.textContent='Перезапустить расширение';
 panel.append(text,restart);(document.getElementById('list-status') || document.getElementById('message')).after(panel);
 let capture=()=>{};
 function save() { capture();localStorage.setItem(key,JSON.stringify(drafts)); }
 function explain(error) {
  const message=error?.message || String(error);
  if(!/Receiving end does not exist|Extension context invalidated|message port closed|message channel closed/i.test(message))return false;
  text.textContent='Нет связи с хранилищем расширения. После обновления файлов перезапустите всё расширение. Затем снова откройте библиотеку или LISTS и проверьте список перед повторным сохранением: предыдущая операция могла выполниться. Обновления вкладки недостаточно. Если кнопка не сработает, откройте chrome://extensions и нажмите «Обновить» у SEO / инспектора. Не удаляйте расширение.';
  panel.hidden=false;return true;
 }
 restart.addEventListener('click',()=>{
  try {save();}catch {text.textContent='Не удалось сохранить черновик. Скопируйте введённый текст перед перезапуском через chrome://extensions.';return;}
  try {chrome.runtime.reload();}catch {text.textContent='Черновик сохранён. Откройте chrome://extensions, нажмите «Обновить» у SEO / инспектора, затем снова откройте библиотеку или LISTS. Не удаляйте расширение.';}
 });
 return {explain, drafts, save, capture(work){capture=work;}, clear(){panel.hidden=true;}};
})();
