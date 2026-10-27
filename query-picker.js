/* Explicit local query picking; never selects a suggestion or starts a search. */
(() => {
 'use strict';
 const wordstat=location.hostname==='wordstat.yandex.ru';
 const normalize=value=>String(value||'').replace(/\s+/g,' ').trim();
 let queued=[],timer,busy=false;const sourceButtons=new WeakMap(),buttonSources=new WeakMap();
 function phrase(node){
  const excluded='.seo-query-add,button,[role="button"],svg,[hidden],[aria-hidden="true"],.counter,.count,.frequency,.Frequency,.mini-suggest__item-count,.wordstat__count,[data-testid*="count"]';
  function walk(current){
   if(current.nodeType===Node.TEXT_NODE)return current.textContent;
   if(current.nodeType!==Node.ELEMENT_NODE||current.matches(excluded))return '';
   const style=getComputedStyle(current);if(style.display==='none'||style.visibility==='hidden')return '';
   if(current.tagName==='BR')return ' ';
   const separated=/^(block|flex|grid|list-item|table-row|table-cell)$/.test(style.display);
   const text=[...current.childNodes].map(walk).join('');return separated?' '+text+' ':text;
  }
  return normalize(walk(node));
 }
 function phraseCell(cell){
  if(cell.closest('nav,header,aside,[class*="profile"],[class*="account"],[class*="settings"],[class*="userinfo"],[class*="user-info"],[class*="menu"]'))return false;
  const anchor=cell.querySelector('a');if(!anchor||/\/(?:profile|account|settings|user|login|logout|passport)(?:[/?#]|$)/i.test(anchor.getAttribute('href')||''))return false;
  const table=cell.closest('table,[role="table"]');
  const firstHeading=table?.querySelector('th,[role="columnheader"]');
  const headingText=firstHeading?phrase(firstHeading):'';
  const heading=/фраз|слов|запрос/i.test(headingText)&&!/числ|колич|частот|баланс|тариф|кредит|лимит/i.test(headingText);
  const known=cell.closest('[data-testid="wordstat-results"],.wordstat-results,.wordstat__results,.wordstat-table');
  let phraseQuery=false;try{const url=new URL(anchor.href,location.href);phraseQuery=url.origin===location.origin&&(url.searchParams.has('words')||url.searchParams.has('text'));}catch{/* Unknown tables stay outside phrase picking. */}
  return heading||!!known||phraseQuery;
 }
 function visible(node){return !!node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'&&!node.closest('[hidden],[aria-hidden="true"]');}
 const message=async(action,values={})=>{const result=await chrome.runtime.sendMessage({type:'seoAnalysisQueue',action,...values});if(!result?.ok)throw new Error(result?.error||'Очередь недоступна');queued=result.queries||[];return queued;};
 function status(text){if(!wordstat)return;let node=document.getElementById('seo-query-queue-status');if(!node){node=document.createElement('div');node.id='seo-query-queue-status';node.setAttribute('role','status');node.style.cssText='position:fixed;bottom:18px;left:18px;z-index:2147483647;background:#151916;color:#ccff5f;padding:8px 12px;border-radius:6px;font:12px sans-serif';document.documentElement.append(node);}const value=text||`Очередь запросов: ${queued.length}/20`;if(node.textContent!==value)node.textContent=value;}
 function update(){document.querySelectorAll('.seo-query-add').forEach(button=>{const selected=queued.some(query=>query.toLowerCase()===button.dataset.seoQuery.toLowerCase());const text=selected?'✓':'+';if(button.textContent!==text)button.textContent=text;button.disabled=selected;button.setAttribute('aria-label',`${selected?'В очереди':'Добавить запрос'}: ${button.dataset.seoQuery}`);});status();}
 function attach(node,text){const previous=sourceButtons.get(node);if(previous&&previous.dataset.seoQuery!==text){previous.remove();sourceButtons.delete(node);}if(!text||text.length>500||/^\d[\d\s.,%]*$/.test(text))return;const parent=node.parentElement;if(!parent)return;let button=sourceButtons.get(node);if(button?.isConnected)return;button=document.createElement('button');button.type='button';button.className='seo-query-add';button.dataset.seoQuery=text;button.textContent='+';button.style.cssText='margin:0 6px;padding:0 5px;min-width:22px;border:1px solid #688d23;border-radius:4px;background:#eefbd8;color:#264100;cursor:pointer;font:14px sans-serif';button.setAttribute('aria-label',`Добавить запрос: ${text}`);
 for(const event of ['pointerdown','mousedown'])button.addEventListener(event,e=>{e.preventDefault();e.stopPropagation();});
 button.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();if(busy)return;busy=true;try{await message('add',{query:text});update();}catch(error){button.title=error.message;status(error.message);}finally{busy=false;}});
 sourceButtons.set(node,button);buttonSources.set(button,node);if(node.matches('a'))node.insertAdjacentElement('afterend',button);else node.append(button);
 }
 function scan(){document.querySelectorAll('.seo-query-add').forEach(button=>{const source=buttonSources.get(button);if(!source?.isConnected)button.remove();});if(wordstat){for(const cell of document.querySelectorAll('table tbody tr td:first-child, [role="row"] [role="cell"]:first-child')){if(!visible(cell)||!phraseCell(cell)){cell.querySelectorAll('.seo-query-add').forEach(button=>button.remove());continue;}const anchor=cell.querySelector('a');if(anchor&&visible(anchor))attach(anchor,phrase(anchor));}}else{for(const option of document.querySelectorAll('[role="listbox"] [role="option"], .mini-suggest__popup [role="option"], .suggest2 [role="option"]')){if(visible(option)){const text=phrase(option);option.querySelectorAll('.seo-query-add').forEach(button=>{if(button.dataset.seoQuery!==text)button.remove();});attach(option,text);}}}update();}
 new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(scan,150);}).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','aria-hidden','style','class']});
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.seoAnalysisQueries){queued=Array.isArray(changes.seoAnalysisQueries.newValue)?changes.seoAnalysisQueries.newValue:[];update();}});
 if(chrome.runtime?.sendMessage)message('get').then(scan).catch(()=>{});
})();
