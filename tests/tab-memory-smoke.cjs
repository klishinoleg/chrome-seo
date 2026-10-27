/* Global popup tab preference in actual extension storage; no toolbar activeTab grant. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser, checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log(`PASS ${label}`); };
(async () => {
  const installed = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launchPersistentContext('', { executablePath: process.env.CHROME_PATH || (fs.existsSync(installed) ? installed : undefined), headless: true, viewport: { width: 800, height: 760 }, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'] });
  const cdp = await browser.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: path.resolve(__dirname, '..') });
  let apiRequests = 0;
  for (const host of ['api.deepseek.com', 'api.keywordseverywhere.com', 'openpagerank.keywordseverywhere.com']) {
    await browser.route(`https://${host}/**`, route => { apiRequests++; return route.fulfill({ status: 500, body: '{}' }); });
  }
  for (const host of ['first.example', 'second.example']) await browser.route(`https://${host}/**`, route => route.fulfill({ contentType: 'text/html', body: '<h1>Local source fixture</h1>' }));
  const source = await browser.newPage();
  await source.goto('https://first.example/page');
  const admin = await browser.newPage();
  await admin.goto(`chrome-extension://${id}/library.html`);
  const set = value => admin.evaluate(value => chrome.storage.local.set({ lastInspectorTab: value }), value);
  const saved = () => admin.evaluate(async () => (await chrome.storage.local.get('lastInspectorTab')).lastInspectorTab);
  let popup;
  const errors = [];
  const open = async init => {
    await popup?.close();
    popup = await browser.newPage();
    popup.on('pageerror', error => errors.push(error.message));
    if (init) await popup.addInitScript(init);
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.locator('[data-tab="meta"]').waitFor();
  };
  const active = () => popup.locator('.panel.active').getAttribute('id');
  const expectTab = tab => popup.waitForFunction(tab => document.querySelector('.panel.active')?.id === tab && document.querySelector('[data-tab].active')?.dataset.tab === tab, tab);
  await open();
  check(await active() === 'meta', 'missing preference defaults to META');
  for (const tab of ['keys', 'micro', 'links', 'search', 'lists', 'ai', 'settings', 'meta']) {
    await popup.locator(`[data-tab="${tab}"]`).click();
    await admin.waitForFunction(async tab => (await chrome.storage.local.get('lastInspectorTab')).lastInspectorTab === tab, tab);
    await open();
    await expectTab(tab);
    check(await saved() === tab, `${tab.toUpperCase()} restores after closing and reopening popup`);
  }
  await popup.locator('[data-tab="links"]').click();
  await admin.waitForFunction(async () => (await chrome.storage.local.get('lastInspectorTab')).lastInspectorTab === 'links');
  await source.goto('https://second.example/different');
  await open();
  await expectTab('links');
  check(new URL(source.url()).hostname === 'second.example' && await active() === 'links', 'same global LINKS preference restores on another site');
  await set('unknown-tab'); await open();
  await popup.waitForTimeout(100);
  check(await active() === 'meta', 'unknown stored tab safely defaults to META');
  await set({ tab: 'links' }); await open();
  await popup.waitForTimeout(100);
  check(await active() === 'meta', 'malformed stored preference cannot select invalid panel');
  await popup.evaluate(() => ['links', 'ai', 'search', 'settings'].forEach(tab => document.querySelector(`[data-tab="${tab}"]`).click()));
  await admin.waitForFunction(async () => (await chrome.storage.local.get('lastInspectorTab')).lastInspectorTab === 'settings');
  await open(); await expectTab('settings');
  check(await active() === 'settings', 'rapid tab changes persist latest selected panel');
  await set('settings');
  await open(() => {
    const original = chrome.storage.local.get.bind(chrome.storage.local);
    chrome.storage.local.get = async keys => {
      if (JSON.stringify(keys).includes('lastInspectorTab')) { await new Promise(resolve => setTimeout(resolve, 600)); return { lastInspectorTab: 'settings' }; }
      return original(keys);
    };
  });
  await popup.locator('[data-tab="links"]').click();
  await popup.waitForTimeout(750);
  check(await active() === 'links', 'late preference read does not override a new user selection');
  await open(() => {
    const original = chrome.storage.local.get.bind(chrome.storage.local);
    chrome.storage.local.get = async keys => {
      if (JSON.stringify(keys).includes('lastInspectorTab')) { window.preferenceReadFailed = true; throw new Error('fixture read failure'); }
      return original(keys);
    };
  });
  await popup.waitForFunction(() => window.preferenceReadFailed);
  await popup.locator('[data-tab="keys"]').click();
  check(await active() === 'keys', 'storage read failure leaves tab controls usable');
  await open(() => {
    const original = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = async values => {
      if (Object.hasOwn(values, 'lastInspectorTab')) { window.preferenceWriteFailed = true; throw new Error('fixture write failure'); }
      return original(values);
    };
  });
  await popup.locator('[data-tab="micro"]').click();
  await popup.waitForFunction(() => window.preferenceWriteFailed);
  check(await active() === 'micro', 'storage write failure does not prevent panel switching');
  check(apiRequests === 0, 'restoring AI or SETTINGS never calls provider APIs');
  check(errors.length === 0, 'preference restoration and storage errors produce no uncaught exceptions');
  console.log(`PASS ${checks} global tab preference integration checks`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
