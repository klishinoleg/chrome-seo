/* Yandex redirect regression: real MV3 sender/tab checks, routed search HTML. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser, checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log(`PASS ${label}`); };
(async () => {
  const installed = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launchPersistentContext('', { executablePath: process.env.CHROME_PATH || (fs.existsSync(installed) ? installed : undefined), headless: true, viewport: { width: 1100, height: 760 }, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'] });
  const cdp = await browser.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: path.resolve(__dirname, '..') });
  await browser.route(/^https?:\/\//, route => route.abort());
  const query = 'уроки вокала онлайн';
  const scenarios = new Map([[query, { rewrite: true }]]);
  const urlFor = (text, cursor = 0) => {
    const url = new URL('https://yandex.ru/search/');
    url.searchParams.set('lr', '105422'); url.searchParams.set('text', text);
    if (cursor) url.searchParams.set('p', cursor);
    return url.href;
  };
  const visits = [];
  await browser.route('https://yandex.ru/**', async route => {
    const url = new URL(route.request().url()), text = url.searchParams.get('text') || '';
    const cursor = Number(url.searchParams.get('p') || 0);
    const scenario = scenarios.get(text) || {};
    if ((scenario.rewrite && cursor === 1 || scenario.rewriteAll) && !url.searchParams.has('rnd')) {
      url.searchParams.set('rnd', '85366');
      if (scenario.reorder) url.href = `https://yandex.ru/search?rnd=85366&p=${cursor}&text=${encodeURIComponent(text)}&lr=105422`;
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<script>location.replace(${JSON.stringify(url.href)})</script>` });
    }
    if (route.request().isNavigationRequest()) visits.push({ text, cursor });
    if (scenario.captcha && cursor === 1 && !scenario.solved) return route.fulfill({ contentType: 'text/html', body: '<form id="captcha-form"><input name="captcha"></form>' });
    const count = cursor ? 10 : 15;
    const cards = Array.from({ length: count }, (_, n) => `<li class="serp-item"><div class="Organic"><h2><a class="OrganicTitle-Link" href="https://${cursor === 1 && n === 1 ? 'target.example' : `other-${cursor}-${n}.example`}/page">Result ${n + 1}</a></h2></div></li>`).join('');
    const nextUrl = new URL(urlFor(text, cursor + (scenario.skip ? 2 : 1)));
    if (scenario.nextRegion) nextUrl.searchParams.set('lr', scenario.nextRegion);
    const next = nextUrl.href.replace(/&/g, '&amp;');
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="ru"><body><ul class="serp-list">${cards}</ul><a class="Pager-Item_type_next" href="${next}">Дальше</a></body></html>` });
  });
  const admin = await browser.newPage(); await admin.goto(`chrome-extension://${id}/popup.html`);
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = async () => {
    const response = await admin.evaluate(() => chrome.runtime.sendMessage({ type: 'seoRankRun', action: 'getStatus' }));
    assert.ok(response.ok, response.error); return response.state;
  };
  const waitState = async (predicate, timeout = 15000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const current = await state(); if (predicate(current)) return current; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(`Yandex state timeout: ${JSON.stringify(await state())}`);
  };
  const begin = async (text, scenario, collect = false) => {
    const previous = await state();
    if (previous && ['running', 'waiting', 'paused'].includes(previous.status)) await admin.evaluate(runId => chrome.runtime.sendMessage({ type: 'seoRankRun', action: 'stop', runId }), previous.id);
    scenarios.set(text, scenario);
    await page.goto(urlFor('подготовка'));
    await page.locator('#rank-toggle').waitFor();
    if (await page.locator('#rank-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#rank-toggle').click();
    await page.locator('#rank-mode').selectOption(collect ? 'collect' : 'rank');
    if (collect) {
      await page.locator('#rank-queries').fill(text); await page.locator('#rank-limit').selectOption('30'); await page.locator('#rank-engine').selectOption('yandex');
    } else { await page.locator('#rank-domain').fill('target.example'); await page.locator('#rank-query').fill(text); }
    await page.locator('#rank-start').click();
    await waitState(current => current?.id && current.id !== previous?.id);
  };
  await begin(query, { rewrite: true });
  let current = await waitState(state => state && ['found', 'paused'].includes(state.status));
  assert.equal(current.status, 'found', `Yandex benign rnd redirect must continue; actual=${JSON.stringify({ status: current.status, reason: current.reason, pagesVisited: current.pagesVisited, resultsSeen: current.resultsSeen, expectedUrl: current.expectedUrl, actualUrl: page.url() })}`);
  check(current.found.position === 17 && current.found.page === 2 && current.found.positionOnPage === 2, 'Yandex follows rnd redirect and counts 15 first-page results before rank17');
  check(visits.filter(visit => visit.text === query).length === 2, 'redirected second page is counted once without visiting a third page');
  await page.waitForFunction(() => document.querySelector('aside[data-seo-lens-search-ui]')?.shadowRoot.querySelector('#rank-status')?.textContent.includes('позиция 17'));
  const evidence = 'C:/Users/klish/.codex/visualizations/2026/10/22/01a1638b-a337-75d1-b3e3-680cfe652ad8';
  fs.mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, 'chrome-seo-yandex-rnd-found.png') });
  await begin('голос + вокал & онлайн', { rewrite: true, reorder: true });
  current = await waitState(state => state && ['found', 'paused'].includes(state.status));
  check(current.status === 'found' && current.found.position === 17 && new URL(page.url()).pathname === '/search', 'Yandex tolerates parameter order encoding and search-path slash alias');
  await begin('смена rnd и перезапуск', {});
  current = await waitState(state => state?.status === 'waiting');
  await page.evaluate(() => { const url = new URL(location.href); url.searchParams.set('rnd', 'first'); url.searchParams.sort(); history.replaceState(null, '', url.href); });
  await page.waitForTimeout(100);
  current = await state();
  check(current.status === 'waiting' && current.resultsSeen === 15 && current.pagesVisited === 1, 'same-page rnd rewrite does not pause or double-count first-page results');
  const worker = (await cdp.send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url === `chrome-extension://${id}/background.js`);
  await cdp.send('Target.closeTarget', { targetId: worker.targetId });
  current = await waitState(state => state && ['found', 'paused'].includes(state.status));
  check(current.status === 'found' && current.found.position === 17, 'worker restart continues from rewritten page without duplicate ranks');
  for (const [name, key, value] of [['запрос', 'text', 'другой запрос'], ['регион', 'lr', '213'], ['страница', 'p', '2'], ['фильтр', 'filter', 'strict']]) {
    await begin(`ручная смена ${name}`, {});
    await waitState(state => state?.status === 'waiting');
    await page.evaluate(({ key, value }) => { const url = new URL(location.href); url.searchParams.set(key, value); history.replaceState(null, '', url.href); }, { key, value });
    current = await waitState(state => state?.status === 'paused');
    check(current.pagesVisited === 1 && current.resultsSeen === 15, `manual ${name} change still pauses without counting another page`);
  }
  for (const [name, scenario] of [['region', { nextRegion: '213' }], ['cursor jump', { skip: true }]]) {
    const text = `invalid next ${name}`;
    await begin(text, scenario);
    current = await waitState(state => state?.status === 'paused');
    check(current.pagesVisited === 1 && visits.filter(visit => visit.text === text).length === 1, `next link changing ${name} is not followed`);
  }
  const captcha = { rewrite: true, captcha: true };
  await begin('капча с rnd', captcha);
  current = await waitState(state => state?.status === 'paused');
  assert.equal(current.reason, 'CAPTCHA requires manual completion');
  captcha.solved = true; await page.reload(); await page.locator('#rank-resume').waitFor();
  await page.locator('#rank-resume').click();
  current = await waitState(state => state?.status === 'found');
  check(current.found.position === 17, 'CAPTCHA remains manual and Resume works on the same page with rnd');
  await begin('сбор с rnd', { rewriteAll: true }, true);
  current = await waitState(state => state?.status === 'completed', 30000);
  await page.waitForURL(`chrome-extension://${id}/competitors.html?report=*`);
  const saved = await admin.evaluate(reportId => chrome.runtime.sendMessage({ type: 'seoCompetitors', action: 'get', reportId }), current.reportId);
  check(saved.ok && saved.result.report.rows.length === 30 && saved.result.report.rows.at(-1).position === 30, 'collection through rnd rewrites saves correct 30-row report');
  check(page.url().includes(current.reportId), 'completed collection opens report after rewritten final URL');
  check(errors.length === 0, 'Yandex URL rewrite handling has no uncaught exceptions');
  console.log(`PASS ${checks} Yandex navigation integration checks (search pages mocked)`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
