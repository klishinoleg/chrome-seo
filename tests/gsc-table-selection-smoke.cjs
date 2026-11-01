/* Private Search Console DOM snapshots, actual MV3 worker, IDB and shared folder. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
let browser, checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log(`PASS ${label}`); };
const server = http.createServer((req, res) => {
  const name = path.resolve(root, `.${new URL(req.url, 'http://local').pathname}`);
  if (!name.startsWith(root + path.sep) || !fs.existsSync(name) || !fs.statSync(name).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
  res.end(fs.readFileSync(name));
});
let rows = [{ domain: 'alpha.example', links: 100, targetPages: 3 }, { domain: 'beta.example', links: 20, targetPages: 1 }];
let filtered = false, total = null, rangeStart = 1;
const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function fixture(resourceId = 'https://first.example/') {
  const count = total ?? rows.length;
  return `<!doctype html><html lang="ru"><head><title>Links report fixture</title></head><body><main><h1>Сайты, ссылающиеся чаще всего</h1><c-wiz jscontroller="RFVDtd" data-p="${escape('%.@.['+JSON.stringify(resourceId)+',42]')}"><div jsname="jyrRxf" jscontroller="uk9a3"><c-wiz jsname="kZksbc" data-p="${escape('%.@.['+JSON.stringify(resourceId)+',42]')}"><div class="xIJlRd"><div class="c1UqTd"><div class="kHsG"><div class="Y9Rb7"><div jsname="BbxQOb" class="Qi0ZXd" style="display:${filtered ? 'block' : 'none'}">${filtered ? '<span>Сайт содержит alpha</span>' : ''}</div><div role="button" jsname="mghfO" aria-label="Фильтрация по строкам таблицы" aria-expanded="false">Фильтр</div></div></div></div></div></c-wiz><div jsname="FOLXuf"><div class="CtOYUe"><table class="i3WFpf"><thead><tr><th data-type="string" data-name="Сайт">Сайт</th><th data-type="number" data-name="Страницы со ссылками на ресурс">Страницы со ссылками на ресурс</th><th data-type="number" data-name="Страницы назначения">Страницы назначения</th></tr></thead><tbody>${rows.map(row => `<tr><td data-string-value="${escape(row.domain)}"><span>${escape(row.domain)}</span><span data-value="${escape(row.domain)}" data-column-type="12">↗</span></td><td data-numeric-value="${row.links}">${row.links}</td><td data-numeric-value="${row.targetPages}">${row.targetPages}</td></tr>`).join('')}</tbody></table></div></div><div class="VgjuZe"><div jsname="WKVttf" class="zKhHyb"><div class="utnMJd"><span class="UwdJ1c">${rows.length ? `${rangeStart}–${rangeStart+rows.length-1}` : '0–0'} из ${count}</span><span data-paginate="previous" aria-disabled="${rangeStart === 1}"></span><span data-paginate="next" aria-disabled="${count === rangeStart+rows.length-1 || !count}"></span></div></div></div></div></c-wiz></main></body></html>`;
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launchPersistentContext('', { executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, viewport: { width: 1100, height: 820 }, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'] });
  const cdp = await browser.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: root });
  await browser.route(/^https?:\/\//, route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await browser.route('https://search.google.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(new URL(route.request().url()).searchParams.get('resource_id') || 'https://first.example/') }));
  const admin = await browser.newPage(); await admin.goto(`chrome-extension://${id}/library.html`);
  const source = await browser.newPage(), errors = [];
  source.on('pageerror', error => { errors.push(error.stack); console.error('GSC PAGE ERROR', error.stack); });
  const property = 'https://first.example/';
  const urlFor = resource => `https://search.google.com/search-console/links/drilldown?${new URLSearchParams({ resource_id: resource, type: 'DOMAIN', target: '', domain: '', hl: 'ru' })}`;
  await source.goto(urlFor(property));
  const tabId = await admin.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, source.url());
  const snapshot = () => admin.evaluate(async tabId => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['gsc-page.js'] });
    const entry=(await chrome.scripting.executeScript({ target: { tabId }, func: async () => { try { const api=globalThis.SeoGscPage; return {data:await(api.freshSnapshot ? api.freshSnapshot() : api.snapshot())}; } catch(error) { return {error:error.message}; } } }))[0].result; if(entry.error) throw new Error(entry.error); return entry.data;
  }, tabId);
  const raw = (action, payload = {}) => admin.evaluate(message => chrome.runtime.sendMessage(message), { type: 'seoGscHistory', action, tabId, resourceId: new URL(source.url()).searchParams.get('resource_id'), ...payload });
  const rpc = async (action, payload) => { const reply = await raw(action, payload); assert.ok(reply?.ok, reply?.error); return reply.result; };
  const capture = async () => rpc('capture', { snapshot: await snapshot() });


  await capture();
  for(const mode of ['hidden','display','aria']) {
    await source.evaluate(mode=>{const wrapper=document.createElement('div');wrapper.id='cached-report';if(mode==='hidden')wrapper.hidden=true;if(mode==='display')wrapper.style.display='none';if(mode==='aria')wrapper.setAttribute('aria-hidden','true');wrapper.append(document.querySelector('c-wiz[jscontroller="RFVDtd"]').cloneNode(true));document.body.append(wrapper);},mode);
    check((await snapshot()).rows.length===2,`${mode} cached report does not block the visible current table`);
    await source.evaluate(()=>document.getElementById('cached-report').remove());
  }
  await source.evaluate(()=>{const table=document.createElement('table');table.id='unrelated';table.className='i3WFpf';table.innerHTML='<thead><tr><th>Other data</th></tr></thead><tbody><tr><td>Unrelated</td></tr></tbody>';document.body.append(table);});
  check((await snapshot()).rows.length===2,'unrelated visible table does not mask a validated report');
  await source.evaluate(()=>document.getElementById('unrelated').remove());
  await source.evaluate(()=>{const report=document.querySelector('c-wiz[jscontroller="RFVDtd"]').cloneNode(true);report.id='other-property-report';const value='%.@.["https://old-project.example/",42]';report.setAttribute('data-p',value);report.querySelector('c-wiz[jsname="kZksbc"]').setAttribute('data-p',value);document.body.append(report);});
  check((await snapshot()).rows.length===2,'visible stale report bound to another resource cannot mask the uniquely matching current project');
  await source.evaluate(()=>document.getElementById('other-property-report').remove());

  await source.evaluate(()=>{const second=document.querySelector('c-wiz[jscontroller="RFVDtd"]').cloneNode(true);second.id='ambiguous';document.body.append(second);});
  let rejected=false;try{await snapshot();}catch{rejected=true;}
  check(rejected,'two real visible report tables remain ambiguous and cannot be saved');
  await source.evaluate(()=>document.getElementById('ambiguous').remove());
  await source.evaluate(()=>{const report=document.querySelector('c-wiz[jscontroller="RFVDtd"]'),html=report.outerHTML;report.remove();setTimeout(()=>document.body.insertAdjacentHTML('beforeend',html),650);});
  check((await snapshot()).rows.length===2,'fresh collection waits for a temporarily absent React table');
  const popup=await browser.newPage();popup.on('pageerror',error=>{errors.push(error.stack);console.error('GSC POPUP ERROR',error.stack);});
  let activeDelay=0;
  await popup.exposeFunction('__gscActive',async()=>{if(activeDelay)await new Promise(resolve=>setTimeout(resolve,activeDelay));return{id:tabId,url:source.url()};});
  await popup.exposeFunction('__gscStorageGet',keys=>admin.evaluate(keys=>chrome.storage.local.get(keys),keys));
  await popup.exposeFunction('__gscStorageSet',data=>admin.evaluate(data=>chrome.storage.local.set(data),data));
  await popup.exposeFunction('__gscMessage',message=>admin.evaluate(message=>chrome.runtime.sendMessage(message),message));
  await popup.exposeFunction('__gscInject',files=>admin.evaluate(({tabId,files})=>chrome.scripting.executeScript({target:{tabId},files}),{tabId,files}));
  await popup.exposeFunction('__gscSnapshot',async()=>{try{return{snapshot:await snapshot()};}catch(error){return{error:error.message};}});
  await popup.exposeFunction('__gscAnalyze',()=>admin.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},func:()=>globalThis.__chromeSeo.analyze()}))[0].result,tabId));
  await popup.exposeFunction('__gscNotify',()=>admin.evaluate(tabId=>chrome.tabs.sendMessage(tabId,{type:'seoGscRefresh'}),tabId));
  await popup.exposeFunction('__gscAnnotate',()=>admin.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},func:()=>globalThis.SeoGscPage.annotate()}))[0].result,tabId));
  await popup.addInitScript(({id,manifest})=>{
    window.chrome={
      tabs:{query:async()=>[await __gscActive()],create:async()=>({id:999}),sendMessage:async()=>__gscNotify(),onActivated:{addListener(){}},onUpdated:{addListener(){}}},
      storage:{local:{get:keys=>__gscStorageGet(keys),set:data=>__gscStorageSet(data)},onChanged:{addListener(){}}},
      runtime:{getURL:file=>`chrome-extension://${id}/${file}`,getManifest:()=>manifest,sendMessage:message=>__gscMessage(message)},
      scripting:{executeScript:async options=>{
        if(options.files)return __gscInject(options.files);
        if(/SeoGscPage\.(?:snapshot|freshSnapshot)/.test(options.func?.toString() || ''))return[{result:await __gscSnapshot()}];
        if(options.func?.toString().includes('SeoGscPage?.annotate'))return[{result:await __gscAnnotate()}];
        if(options.args?.[0]==='analyze')return[{result:await __gscAnalyze()}];
        return[{result:null}];
      }}
    };
  },{id,manifest:JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'))});

  await popup.goto(`${local}/popup.html`);await popup.locator('[data-tab="gsc"]').waitFor({state:'visible'});await popup.locator('[data-tab="gsc"]').click();
  const nextProperty='https://next-project.example/';rows=[{domain:'new-source.example',links:9,targetPages:2}];
  await source.evaluate(({url,html})=>{
    history.pushState({},'',url);
    setTimeout(()=>{const old=document.querySelector('c-wiz[jscontroller="RFVDtd"]');old.hidden=true;const parsed=new DOMParser().parseFromString(html,'text/html');document.body.insertAdjacentHTML('beforeend',parsed.body.innerHTML);},650);
  },{url:urlFor(nextProperty),html:fixture(nextProperty)});
  await popup.locator('#gsc-capture').click();
  await popup.waitForFunction(()=>!document.getElementById('gsc-capture').disabled && !document.getElementById('gsc-status').textContent.includes('Проверяем'));
  const state=await rpc('get');
  check(state.history.length===1 && state.workingDay.rows.length===1 && state.workingDay.rows[0].domain==='new-source.example','Save discards stale popup binding and reads the newly rendered SPA project');
  check(await popup.locator('#gsc-resource').textContent()===nextProperty,'popup history switches to the live captured project');
  await admin.evaluate(async tabId=>{await chrome.scripting.executeScript({target:{tabId},func:()=>{
    globalThis.__oldMutationObserver=globalThis.MutationObserver;globalThis.__replacementObservers=0;
    globalThis.MutationObserver=function(...args){globalThis.__replacementObservers++;return new globalThis.__oldMutationObserver(...args);};
    globalThis.SeoGscPage={snapshot:()=>({resourceId:'stale-project'})};
  }});},tabId);
  check((await snapshot()).rows[0].domain==='new-source.example','Save reinjection replaces stale collector exports with the current live reader');
  const observerCount=await admin.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},func:()=>{const count=globalThis.__replacementObservers;globalThis.MutationObserver=globalThis.__oldMutationObserver;return count;}}))[0].result,tabId);
  check(observerCount===0,'legacy collector replacement does not install a duplicate mutation observer');
  rows=[{domain:'third-source.example',links:3,targetPages:1}];
  await source.evaluate(({url,html})=>{document.querySelectorAll('c-wiz[jscontroller="RFVDtd"]').forEach(n=>n.remove());setTimeout(()=>{history.pushState({},'',url);const doc=new DOMParser().parseFromString(html,'text/html');document.body.insertAdjacentHTML('beforeend',doc.body.innerHTML);},300);},{url:urlFor('https://third-project.example/'),html:fixture('https://third-project.example/')});
  rejected=false;try{await snapshot();}catch{rejected=true;}
  check(rejected && (await rpc('get')).history.length===0,'project change during a pending DOM read aborts without creating a mixed snapshot');
  rows=[{domain:'new-source.example',links:9,targetPages:2}];await source.goto(urlFor(nextProperty));
  await source.evaluate(()=>document.querySelectorAll('c-wiz[jscontroller="RFVDtd"]').forEach(n=>n.remove()));
  const missingStart=Date.now();rejected=false;try{await snapshot();}catch{rejected=true;}
  check(rejected && Date.now()-missingStart<5000,'permanently missing table fails in a bounded time without erasing saved data');
  check((await rpc('get')).workingDay.rows[0].domain==='new-source.example','failed refresh leaves the previous stored snapshot intact');
  check(errors.length===0,`selection and SPA capture have no uncaught exceptions: ${JSON.stringify(errors)}`);
  console.log(`PASS ${checks} GSC live table selection and SPA capture checks`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
