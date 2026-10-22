/* Simulates unpacked files updated before Chrome reloads its registered manifest. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
let browser;
(async () => {
  const source = path.resolve(__dirname, '..');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-upgrade-'));
  for (const file of fs.readdirSync(source)) {
    if (file.startsWith('.') || file === 'tests' || file === 'node_modules') continue;
    const sourceFile = path.join(source, file);
    fs.cpSync(sourceFile, path.join(fixture, file), { recursive: true });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture, 'manifest.json')));
  const oldManifest = { ...manifest, version: '0.1.0' };
  delete oldManifest.background;
  fs.writeFileSync(path.join(fixture, 'manifest.json'), JSON.stringify(oldManifest));
  const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launchPersistentContext('', { executablePath: process.env.CHROME_PATH || (fs.existsSync(chromePath) ? chromePath : undefined), headless: true, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'] });
  const settings = await browser.newPage();
  await settings.goto('chrome://extensions');
  await settings.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }));
  const cdp = await browser.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: fixture });
  fs.writeFileSync(path.join(fixture, 'manifest.json'), JSON.stringify(manifest));
  let page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/library.html`);
  const registered = await page.evaluate(() => ({ version: chrome.runtime.getManifest().version, background: chrome.runtime.getManifest().background || null }));
  assert.deepEqual(registered, { version: '0.1.0', background: null });
  console.log('PASS registered manifest still0.1.0 without background while source files are current version');
  await page.locator('#new-name').fill('explore-bulgaria-links');
  await page.locator('#new-list').click();
  await page.waitForFunction(() => document.querySelector('#message').textContent.length > 0);
  console.log('BEFORE RELOAD', await page.locator('#message').textContent());
  assert.match(await page.locator('#message').textContent(), /Receiving end does not exist/);
  assert.equal(await page.locator('#current-list option').count(), 0);
  console.log('PASS missing receiver reproduces Create failure without changing records');
  if (process.env.REPRO_ONLY === '1') return;
  const recovery = page.locator('#restart-extension');
  await recovery.waitFor({ state: 'visible', timeout: 5000 });
  const closed = page.waitForEvent('close');
  const restarted = browser.waitForEvent('serviceworker', { predicate: worker => worker.url() === `chrome-extension://${id}/background.js`, timeout: 7000 }).catch(() => null);
  await recovery.click();
  await closed;
  const workerAfterReload = await restarted;
  if (!workerAfterReload) {
    const diagnostics = await browser.newPage();
    await diagnostics.goto('chrome://extensions');
    console.log('RELOAD DIAGNOSTICS', await diagnostics.evaluate(extensionId => new Promise(resolve => chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }, values => resolve(values.filter(value => value.id === extensionId).map(value => ({ id: value.id, version: value.version, state: value.state, disableReasons: value.disableReasons, manifestErrors: value.manifestErrors }))))), id));
    throw new Error('Background did not register after explicit extension reload');
  }
  // Chrome closes extension pages on reload; reopen as the operator is instructed.
  page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/library.html`);
  await page.waitForFunction(() => chrome.runtime.getManifest().background?.service_worker === 'background.js');
  await page.waitForFunction(() => document.querySelector('#new-name').value === 'explore-bulgaria-links');
  assert.equal(await page.locator('#current-list option').count(), 0);
  console.log('PASS extension reload restores draft without replaying failed mutation');
  await page.locator('#new-list').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#current-list option')].some(option => option.textContent === 'explore-bulgaria-links'));
  assert.equal(await page.locator('#current-list option').count(), 1);
  console.log('PASS upgrade recovery restores draft and Create button creates one list');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
