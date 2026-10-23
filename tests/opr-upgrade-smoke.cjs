/* Updating files does not update Chrome's registered worker or provider permissions. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser, checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log(`PASS ${label}`); };
(async () => {
  const root = path.resolve(__dirname, '..');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-opr-upgrade-'));
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith('.') || ['tests', 'node_modules'].includes(name)) continue;
    fs.cpSync(path.join(root, name), path.join(fixture, name), { recursive: true });
  }
  const currentManifest = fs.readFileSync(path.join(root, 'manifest.json'));
  const oldFile = name => cp.execFileSync('git', ['show', `3748189:${name}`], { cwd: root });
  fs.writeFileSync(path.join(fixture, 'manifest.json'), oldFile('manifest.json'));
  fs.writeFileSync(path.join(fixture, 'background.js'), oldFile('background.js'));
  const installed = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launchPersistentContext('', { executablePath: process.env.CHROME_PATH || (fs.existsSync(installed) ? installed : undefined), headless: true, viewport: { width: 800, height: 740 }, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'] });
  const chromeSettings = await browser.newPage();
  await chromeSettings.goto('chrome://extensions');
  await chromeSettings.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
  const cdp = await browser.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: fixture });
  let page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/library.html`);
  const previous = await page.evaluate(async () => ({
    list: await chrome.runtime.sendMessage({ type: 'seoLists', action: 'createList', name: 'Мои площадки' }),
    deepseek: await chrome.runtime.sendMessage({ type: 'seoDeepSeek', action: 'saveSettings', key: 'sk-fake-ke-upgrade-only', model: 'deepseek-flash' })
  }));
  assert.ok(previous.list.ok && previous.deepseek.ok);
  fs.writeFileSync(path.join(fixture, 'manifest.json'), currentManifest);
  fs.copyFileSync(path.join(root, 'background.js'), path.join(fixture, 'background.js'));
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.locator('[data-tab="settings"]').click();
  check(!(await page.evaluate(() => chrome.runtime.getManifest().host_permissions)).includes('https://openpagerank.keywordseverywhere.com/*'), 'old registered manifest lacks OPR permission despite new UI files');
  check(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'seoOpenPageRank', action: 'getSettings' })) === undefined, 'cached old worker has no OPR handler');
  await page.locator('#opr-key').fill('opr_live_upgrade_fake');
  await page.locator('#opr-save').click();
  await page.locator('#opr-reload').waitFor({ state: 'visible' });
  check(/обновите|обновления/i.test(await page.locator('#opr-status').textContent()), 'OPR settings offer whole-extension recovery');
  check(!JSON.stringify(await page.evaluate(() => chrome.storage.local.get(null))).includes('opr_live_upgrade_fake'), 'uncertain save never persists secret draft in shared storage');
  const closed = page.waitForEvent('close');
  const started = browser.waitForEvent('serviceworker', { predicate: worker => worker.url() === `chrome-extension://${id}/background.js`, timeout: 10000 }).catch(() => null);
  await page.locator('#opr-reload').click();
  await closed;
  await started;
  page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.locator('[data-tab="settings"]').click();
  await page.waitForFunction(() => document.querySelector('#opr-status').textContent.includes('Добавьте отдельный ключ'));
  const result = await page.evaluate(async () => ({
    opr: await chrome.runtime.sendMessage({ type: 'seoOpenPageRank', action: 'getSettings' }),
    ke: await chrome.runtime.sendMessage({ type: 'seoOpenPageRank', action: 'getCreditSettings' }),
    deepseek: await chrome.runtime.sendMessage({ type: 'seoDeepSeek', action: 'getSettings' }),
    lists: await chrome.runtime.sendMessage({ type: 'seoLists', action: 'get' }),
    permissions: chrome.runtime.getManifest().host_permissions
  }));
  check(result.opr.ok && !result.opr.result.hasKey && result.ke.ok && !result.ke.result.hasKey, 'reload activates both provider APIs without replaying uncertain key save');
  check(result.permissions.includes('https://openpagerank.keywordseverywhere.com/*') && result.permissions.includes('https://api.keywordseverywhere.com/*'), 'reload registers both narrow provider permissions');
  check(result.deepseek.ok && result.deepseek.result.hasKey && result.lists.ok && result.lists.state.data.lists.some(list => list.name === 'Мои площадки'), 'OPR upgrade preserves DeepSeek secret and saved URL lists');
  await page.locator('#opr-key').fill('opr_live_upgrade_fake');
  await page.locator('#opr-save').click();
  await page.waitForFunction(() => document.querySelector('#opr-status').textContent.includes('сохранён'));
  check((await page.evaluate(() => chrome.runtime.sendMessage({ type: 'seoOpenPageRank', action: 'getSettings' }))).result.hasKey, 'manual key save succeeds after whole-extension reload');
  console.log(`PASS ${checks} OPR upgrade recovery checks`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
