'use strict';
// A single queue orders restore, commits and deletes; no delayed input callbacks.
(() => {
 const fields = {
  'search-domain': {key:'historySearchDomains', saved:'searchTargetDomain'},
  'search-query': {key:'historySearchQueries', saved:'searchQuery'},
  'links-domain': {key:'historyLinksDomains', saved:'linksDomain'}
 };
 const histories = {};
 const clean = value => typeof value === 'string' ? value.trim().slice(0,2000) : '';
 function normalize(values) {
  const seen=new Set();
  return (Array.isArray(values) ? values : []).map(clean).filter(value=>{
   const key=value.toLowerCase();
   if(!value || seen.has(key)) return false;
   seen.add(key); return true;
  }).slice(0,12);
 }
 let initialization;
 let queue=Promise.resolve();
 function report(error) {
  const status=document.getElementById('status');
  if(status) status.textContent=`Не удалось сохранить историю: ${error.message || error}`;
 }
 function render(id) {
  const container=document.getElementById(`history-${id}`);
  const input=document.getElementById(id);
  if(!container || !input) return;
  container.replaceChildren();
  for(const value of histories[id]) {
   const chip=document.createElement('span'); chip.className='history-chip';
   const apply=document.createElement('button'); apply.type='button'; apply.className='history-value';
   apply.textContent=value; apply.title=value;
   apply.addEventListener('click',()=>{
    input.value=value;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
   });
   const remove=document.createElement('button'); remove.type='button'; remove.className='history-remove';
   remove.textContent='×'; remove.title=`Удалить: ${value}`; remove.setAttribute('aria-label',`Удалить из истории: ${value}`);
   remove.addEventListener('click',event=>{
    event.preventDefault(); event.stopPropagation();
    enqueue(async()=>{
     const next=histories[id].filter(item=>item.toLowerCase()!==value.toLowerCase());
     await chrome.storage.local.set({[fields[id].key]:next});
     histories[id]=next; render(id);
    }).catch(report);
   });
   chip.append(apply,remove); container.append(chip);
  }
 }
 function init() {
  if(initialization) return initialization;
  initialization=(async()=>{
   const saved=await chrome.storage.local.get(Object.values(fields).flatMap(field=>[field.key,field.saved]));
   const seeds={};
   for(const [id,field] of Object.entries(fields)) {
    const absent=!Object.prototype.hasOwnProperty.call(saved,field.key);
    histories[id]=normalize(absent ? [saved[field.saved]] : saved[field.key]);
    if(absent) seeds[field.key]=histories[id];
    render(id);
    const input=document.getElementById(id);
    input?.addEventListener('change',()=>remember(id).catch(report));
    input?.addEventListener('keydown',event=>{if(event.key==='Enter' && !event.isComposing) remember(id).catch(report);});
   }
   if(Object.keys(seeds).length) await chrome.storage.local.set(seeds);
  })();
  return initialization;
 }
 function enqueue(work) {
  const result=queue.then(()=>init()).then(work);
  queue=result.catch(()=>{});
  return result;
 }
 function remember(id) {
  if(!fields[id]) return Promise.resolve();
  const value=clean(document.getElementById(id)?.value);
  return enqueue(async()=>{
   if(!value) return;
   const next=normalize([value,...histories[id]]);
   await chrome.storage.local.set({[fields[id].key]:next});
   histories[id]=next; render(id);
  });
 }
 globalThis.SeoInputHistory={init,remember};
})();
