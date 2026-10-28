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
    const input = `<input class="HeaderForm-Input" name="text" type="text" value="${escaped(scenario.inputMismatch ? 'не связанный запрос' : nextQuery)}" ${scenario.hiddenInput ? 'style="display:none"' : ''}>`;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="ru"><body><form action="/search/">${input}${scenario.duplicateInput ? input : ''}</form>${notice}<ul class="serp-list">${cards}</ul><nav class="VanillaReact Pager"><div class="Pager-Content" role="list"><div class="Pager-ListItem Pager-ListItem_type_next" role="listitem"><a class="Button Button_view_clear Button_link VanillaReact Pager-Item Pager-Item_type_next" ${scenario.hiddenNext ? 'hidden' : ''} ${scenario.disabledNext ? 'aria-disabled="true"' : ''} aria-label="Следующая страница" href="${escaped(next.href)}">Дальше</a></div></div></nav></body></html>` });
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
  await begin(original, { corrected });
  let current = await waitState(state => state && ['found', 'paused'].includes(state.status));
  assert.equal(current.status, 'found', `Visible Yandex correction must allow observed next link; actual=${JSON.stringify({ status: current.status, reason: current.reason, pagesVisited: current.pagesVisited, resultsSeen: current.resultsSeen, actualUrl: page.url() })}`);
  check(current.found.position === 18 && current.found.page === 2 && current.found.positionOnPage === 2, 'visible Yandex correction continues after16 results to rank18 on page2');
  check(current.query === original && new URL(page.url()).searchParams.get('text') === corrected, 'requested query remains original while navigation follows verified correction');
  check(visits.filter(visit => [original, corrected].includes(visit.text)).length === 2 && errors.length === 0, 'corrected pages are counted once without browser errors');
  await page.waitForFunction(() => document.querySelector('aside[data-seo-lens-search-ui]')?.shadowRoot.querySelector('#rank-status')?.textContent.includes('позиция 18'));
  const evidence = 'C:/Users/klish/.codex/visualizations/2026/10/22/01a1638b-a337-75d1-b3e3-680cfe652ad8'; fs.mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, 'chrome-seo-yandex-correction.png') });
  for (const [name, options] of [
    ['missing notice', { noNotice: true }], ['hidden notice', { hiddenNotice: true }],
    ['hidden input', { hiddenInput: true }], ['ambiguous inputs', { duplicateInput: true }],
    ['wrong notice text', { noticeText: 'Похожие запросы.' }], ['input mismatch', { inputMismatch: true }],
    ['wrong cancel query', { badCancelQuery: true }], ['wrong cancel region', { badCancelRegion: true }],
    ['wrong cancellation flag', { badCancelMode: true }], ['next region change', { badNextRegion: true }],
    ['cursor skip', { skip: true }], ['duplicate next query', { duplicateText: true }],
    ['hidden next link', { hiddenNext: true }], ['disabled next link', { disabledNext: true }]
  ]) {
    const text = `недоверенное исправление ${name}`;
    await begin(text, { corrected, ...options });
    current = await waitState(state => state && ['found', 'paused'].includes(state.status));
    check(current.status === 'paused' && current.pagesVisited === 1 && current.resultsSeen === 16 && new URL(page.url()).searchParams.get('text') === text, `${name} cannot authorize a changed search query`);
  }
  const restartQuery = 'уровки вокала перезапуск', restartCorrection = 'уроки вокала перезапуск';
  await begin(restartQuery, { corrected: restartCorrection });
  await waitState(state => state?.status === 'waiting');
  const worker = (await cdp.send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url === `chrome-extension://${id}/background.js`);
  await cdp.send('Target.closeTarget', { targetId: worker.targetId });
  current = await waitState(state => state && ['found', 'paused'].includes(state.status));
  check(current.status === 'found' && current.found.position === 18 && current.query === restartQuery, 'pending verified correction survives actual worker restart');
  const stoppedQuery = 'уровки отмена'; await begin(stoppedQuery, { corrected: 'уроки отмена' });
  await waitState(state => state?.status === 'waiting'); await page.locator('#rank-stop').click();
  await page.waitForTimeout(2800); current = await state();
  check(current.status === 'stopped' && new URL(page.url()).searchParams.get('text') === stoppedQuery, 'Stop cancels pending corrected-query navigation');
  const captcha = { corrected: 'уроки капча', captcha: true }; await begin('уровки капча', captcha);
  current = await waitState(state => state?.status === 'paused'); assert.equal(current.reason, 'CAPTCHA requires manual completion');
  captcha.solved = true; await page.reload(); await page.locator('#rank-resume').waitFor(); await page.locator('#rank-resume').click();
  current = await waitState(state => state?.status === 'found');
  check(current.found.position === 18 && current.query === 'уровки капча', 'manual CAPTCHA resume retains verified effective query and original attribution');
  const batchOriginal = 'уровки сбор', batchCorrected = 'уроки сбор', second = 'обычный запрос';
  await begin([batchOriginal, second], { corrected: batchCorrected }, true);
  current = await waitState(state => state?.status === 'completed', 45000); await page.waitForURL(`chrome-extension://${id}/competitors.html?report=*`);
  const saved = await admin.evaluate(reportId => chrome.runtime.sendMessage({ type: 'seoCompetitors', action: 'get', reportId }), current.reportId);
  check(saved.ok && saved.result.report.rows.length === 60 && saved.result.report.rows.filter(row => row.query === batchOriginal).length === 30 && !saved.result.report.rows.some(row => row.query === batchCorrected), 'batch correction saves rows under original requested query');
  check(saved.result.report.rows.filter(row => row.query === second).length === 30 && current.query === second && current.effectiveQuery === second, 'next batch query resets effective correction state');
  check(errors.length === 0, 'correction proof validation and report collection have no uncaught exceptions');
  console.log(`PASS ${checks} Yandex correction integration checks (search pages mocked)`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
