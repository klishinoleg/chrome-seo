/* Observed Yandex misspelling correction must retain requested-query attribution. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser, checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log(`PASS ${label}`); };
(async () => {
  const installed = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launchPersistentContext('', { executablePath: process.env.CHROME_PATH || (fs.existsSync(installed) ? installed : undefined), headless: true, viewport: { width: 1100, height: 780 }, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'] });
  const cdp = await browser.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: path.resolve(__dirname, '..') });
  await browser.route(/^https?:\/\//, route => route.abort());
  const original = 'уровки вокала онлайн', corrected = 'уроки вокала онлайн';
  const scenarios = new Map([[original, { corrected }]]);
  const urlFor = (text, cursor = 0) => { const url = new URL('https://yandex.ru/search/'); url.searchParams.set('lr', '105422'); url.searchParams.set('text', text); if (cursor) url.searchParams.set('p', cursor); return url.href; };
  const escaped = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const visits = [];
  await browser.route('https://yandex.ru/**', route => {
    const url = new URL(route.request().url()), text = url.searchParams.get('text') || '', cursor = Number(url.searchParams.get('p') || 0);
    if (route.request().isNavigationRequest()) visits.push({ text, cursor });
    const scenario = scenarios.get(text) || [...scenarios.values()].find(item => item.corrected === text) || {};
    const isCorrection = scenario.corrected && text !== scenario.corrected;
    const nextQuery = isCorrection ? scenario.corrected : text;
    const cancel = new URL(url); cancel.searchParams.set('noreask', '1');
    if (scenario.badCancelQuery) cancel.searchParams.set('text', 'другой запрос');
    if (scenario.badCancelRegion) cancel.searchParams.set('lr', '213');
    if (scenario.badCancelMode) cancel.searchParams.set('noreask', '0');
    const notice = isCorrection && !scenario.noNotice ? `<div class="Root Root_inited" id="MisspellReask__fixture" ${scenario.hiddenNotice ? 'hidden' : ''}><div class="RequestMeta-Level RequestMeta-Level_type_reask"><div class="RequestMeta-Message">${scenario.noticeText || 'Исправлена опечатка в слове «уровки».'} <a href="${escaped(cancel.href)}">Отменить</a></div></div></div>` : '';
    if (scenario.captcha && cursor === 1 && !scenario.solved) return route.fulfill({ contentType: 'text/html', body: '<form id="captcha-form"><input name="captcha"></form>' });
    const count = cursor ? 10 : 16;
    const cards = Array.from({ length: count }, (_, n) => `<li class="serp-item"><div class="Organic"><h2><a class="OrganicTitle-Link" href="https://${cursor === 1 && n === 1 ? 'target.example' : `site-${cursor}-${n}.example`}/page">Result ${n + 1}</a></h2></div></li>`).join('');
    const next = new URL(urlFor(nextQuery, cursor + (scenario.skip ? 2 : 1))); next.searchParams.set('rnd', '79782');
    if (scenario.badNextRegion) next.searchParams.set('lr', '213');
    if (scenario.duplicateText) next.searchParams.append('text', nextQuery);
    const input = `<input class="HeaderForm-Input" name="text" type="text" value="${escaped(scenario.inputMismatch ? 'не связанный запрос' : nextQuery)}" ${scenario.hiddenInput ? 'style="display:none"' : ''} ${scenario.hydrated ? 'aria-hidden="true" tabindex="-1"' : ''}>`;
    const pager = scenario.noPager ? '' : `<nav class="VanillaReact Pager"><div class="Pager-Content" role="list"><div class="Pager-ListItem Pager-ListItem_type_next" role="listitem"><a class="Button Button_view_clear Button_link VanillaReact Pager-Item Pager-Item_type_next" ${scenario.hiddenNext ? 'hidden' : ''} ${scenario.disabledNext ? 'aria-disabled="true"' : ''} aria-label="Следующая страница" href="${escaped(next.href)}">Дальше</a></div></div></nav>`;
    const fields = scenario.hydrated ? `<div class="HeaderForm-InputContainer">${input}<textarea class="HeaderForm-Input mini-suggest__input beauty-scroll" role="combobox" aria-label="Запрос" ${scenario.hiddenTextarea ? 'hidden' : ''}>${escaped(scenario.textareaMismatch ? 'несвязанный текст' : nextQuery)}</textarea></div>` : input;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="ru"><body><form action="/search/">${fields}${scenario.duplicateInput ? fields : ''}</form>${notice}<ul class="serp-list">${cards}</ul>${pager}</body></html>` });
  });
  const admin = await browser.newPage(); await admin.goto(`chrome-extension://${id}/popup.html`);
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = async () => { const result = await admin.evaluate(() => chrome.runtime.sendMessage({ type: 'seoRankRun', action: 'getStatus' })); assert.ok(result.ok, result.error); return result.state; };
  const waitState = async (predicate, timeout = 15000) => { const end = Date.now() + timeout; while (Date.now() < end) { const current = await state(); if (predicate(current)) return current; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Correction timeout: ${JSON.stringify(await state())}`); };
  const begin = async (text, scenario, collect = false) => {
    const previous = await state();
    if (previous && ['running', 'waiting', 'paused'].includes(previous.status)) await admin.evaluate(runId => chrome.runtime.sendMessage({ type: 'seoRankRun', action: 'stop', runId }), previous.id);
    scenarios.set(Array.isArray(text) ? text[0] : text, scenario);
    await page.goto(urlFor('подготовка')); await page.locator('#rank-toggle').waitFor();
    if (await page.locator('#rank-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#rank-toggle').click();
    await page.locator('#rank-mode').selectOption(collect ? 'collect' : 'rank');
    if (collect) { await page.locator('#rank-queries').fill(text.join('\n')); await page.locator('#rank-limit').selectOption('30'); await page.locator('#rank-engine').selectOption('yandex'); }
    else { await page.locator('#rank-domain').fill('target.example'); await page.locator('#rank-query').fill(text); }
    await page.locator('#rank-start').click();
    await waitState(current => current?.id && current.id !== previous?.id);
  };


  const installPager = href => page.evaluate(value => {
    document.querySelectorAll('nav.Pager').forEach(n=>n.remove());
    const nav=document.createElement('nav');nav.className='VanillaReact Pager';
    const a=document.createElement('a');a.className='Button Button_link Pager-Item Pager-Item_type_next';a.href=value;a.setAttribute('aria-label','Следующая страница');a.textContent='дальше';nav.append(a);document.body.append(nav);
  },href);
  const selected=process.env.PAGER_CASE;
  if (!selected || selected === 'hydrated') {
    await begin(original,{corrected,hydrated:true});
    let current=await waitState(s=>s && ['found','paused'].includes(s.status));
    assert.equal(current.status,'found',`Visible textarea must authorize correction: ${JSON.stringify(current)}`);
    check(current.found.position===18 && current.pagesVisited===2,'actual hydrated Yandex textarea supports corrected next-page navigation');
    check(current.query===original && current.effectiveQuery===corrected,'textarea correction keeps requested query attribution');
    for(const [name,options] of [['hidden textarea',{hiddenTextarea:true}],['duplicate visible controls',{duplicateInput:true}],['textarea mismatch',{textareaMismatch:true}],['missing correction notice',{noNotice:true}]]) {
      await begin(`уровки ${name}`,{corrected,hydrated:true,...options});
      current=await waitState(s=>s && ['found','paused'].includes(s.status));
      check(current.status==='paused' && current.pagesVisited===1 && current.resultsSeen===16,`${name} cannot authorize hydrated correction`);
    }
  }
  if (!selected || selected === 'resume') {
    const query='восстановить переход';await begin(query,{noPager:true});
    let current=await waitState(s=>s?.status==='paused');assert.equal(current.reason,'Next-page link is unavailable');
    check(current.pagesVisited===1 && current.resultsSeen===16,'missing pager pauses after counting the first16 results once');
    await page.locator('#rank-resume').click();
    current=await waitState(s=>s?.status==='paused');
    check(current.reason==='Next-page link is unavailable' && current.pagesVisited===1 && current.resultsSeen===16,'Continue without a pager retains original counts and actionable pause');
    const unsafe=new URL(urlFor(query,1));unsafe.searchParams.set('lr','213');await installPager(unsafe.href);
    await page.locator('#rank-resume').click();current=await waitState(s=>s?.status==='paused');
    check(current.reason==='Invalid or repeated next-page URL' && current.resultsSeen===16 && new URL(page.url()).searchParams.get('p')===null,'pagination retry rejects changed region without recounting or navigating');
    await installPager(urlFor(query,1));await page.locator('#rank-resume').click();
    current=await waitState(s=>s && ['found','paused'].includes(s.status));
    assert.equal(current.status,'found',`Resume must retry pagination without recount: ${JSON.stringify(current)}`);
    check(current.found.position===18 && current.resultsSeen===18 && current.pagesVisited===2,'Continue retries a newly available pager without duplicate first-page results');
    const evidence='C:/Users/klish/.codex/visualizations/2026/10/22/01a1638b-a337-75d1-b3e3-680cfe652ad8';fs.mkdirSync(evidence,{recursive:true});
    await page.screenshot({path:path.join(evidence,'chrome-seo-yandex-pager-recovered.png')});
    const restartQuery='переход перезапуск';await begin(restartQuery,{noPager:true});
    await waitState(s=>s?.status==='paused');await installPager(urlFor(restartQuery,1));await page.locator('#rank-resume').click();
    await waitState(s=>s?.status==='waiting');
    const worker=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker' && t.url===`chrome-extension://${id}/background.js`);
    await cdp.send('Target.closeTarget',{targetId:worker.targetId});current=await waitState(s=>s && ['found','paused'].includes(s.status));
    check(current.status==='found' && current.found.position===18 && current.pagesVisited===2,'retried navigation survives an actual worker restart without duplicate counts');
    const stopQuery='переход стоп';await begin(stopQuery,{noPager:true});await waitState(s=>s?.status==='paused');
    await installPager(urlFor(stopQuery,1));await page.locator('#rank-resume').click();await waitState(s=>s?.status==='waiting');await page.locator('#rank-stop').click();
    await page.waitForTimeout(2800);current=await state();
    check(current.status==='stopped' && current.resultsSeen===16 && new URL(page.url()).searchParams.get('p')===null,'Stop cancels a retried next-page navigation');
  }
  if(!selected || selected==='collect') {
    const query='сбор восстановление';const scenario={badNextRegion:true};await begin([query],scenario,true);
    let current=await waitState(s=>s?.status==='paused');check(current.resultsSeen===16,'invalid collection pager retains the first16 saved rows');
    scenario.badNextRegion=false;await installPager(urlFor(query,1));await page.locator('#rank-resume').click();
    current=await waitState(s=>s?.status==='completed',25000);await page.waitForURL(`chrome-extension://${id}/competitors.html?report=*`);
    const saved=await admin.evaluate(reportId=>chrome.runtime.sendMessage({type:'seoCompetitors',action:'get',reportId}),current.reportId);
    const rows=saved.result.report.rows;
    check(saved.ok && rows.length===30 && new Set(rows.map(row=>row.position)).size===30 && rows.every(row=>row.query===query),'Continue with valid collection pager resumes the same query to30 without duplicate rows');
    check(saved.result.report.queryResults[0].status==='completed' && saved.result.report.queryResults[0].count===30,'collection retry does not silently accept16 as a partial query');
  }
  check(errors.length===0,'Yandex pager recovery has no uncaught exceptions');
  console.log(`PASS ${checks} Yandex pager recovery integration checks (search pages mocked)`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();});
