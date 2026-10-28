/* Pure URL equivalence and strict worker-boundary regressions. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log(`PASS ${label}`); };
const source = fs.readFileSync(path.join(__dirname, '..', 'serp-url.js'), 'utf8');
const runner = fs.readFileSync(path.join(__dirname, '..', 'rank-runner.js'), 'utf8');
const context = vm.createContext({ URL }); vm.runInContext(source, context);
const { expectedMatches, nextMatches } = context.SeoSerpUrl;
const base = 'https://yandex.ru/search/?lr=105422&text=уроки+вокала&p=1';
for (const [actual, label] of [
  [base + '&rnd=85366', 'rnd addition'],
  [base + '&rnd=other#fragment', 'rnd replacement and fragment'],
  ['https://yandex.ru/search?p=1&text=уроки%20вокала&lr=105422&rnd=1', 'order encoding and slash alias'],
  [base + '&rnd=1&rnd=2', 'multiple ignored rnd values']
]) check(expectedMatches(actual, base), `Yandex expected-page match accepts ${label}`);
for (const [actual, label] of [
  [base.replace('p=1', 'p=2'), 'cursor change'],
  [base.replace('105422', '213'), 'region change'],
  [base.replace('уроки+вокала', 'другой+запрос'), 'query change'],
  [base + '&filter=strict', 'filter addition'],
  [base + '&unknown=value', 'unknown parameter'],
  [base + '&RND=1', 'differently cased RND'],
  [base.replace('yandex.ru', 'yandex.com'), 'origin change'],
  [base.replace('yandex.ru', 'yandex.ru:8443'), 'port change'],
  [base.replace('https:', 'http:'), 'scheme change'],
  [base.replace('yandex.ru/', 'user:pass@yandex.ru/'), 'credentials'],
  [base.replace('/search/', '/showcaptcha'), 'challenge path'],
  [base + '&p=1', 'duplicate cursor'],
  [base.replace('p=1', 'p=01'), 'cursor spelling change']
]) check(!expectedMatches(actual, base), `Yandex expected-page match rejects ${label}`);
check(!expectedMatches('https://yandex.ru/search/?text=вокал&p=0', 'https://yandex.ru/search/?text=вокал'), 'omitted cursor and explicit zero remain distinct expected documents');
check(expectedMatches('https://yandex.ru/search/?text=a&text=b&lr=1', 'https://yandex.ru/search/?lr=1&text=a&text=b'), 'parameter-name sorting preserves duplicate-value sequence');
check(!expectedMatches('https://yandex.ru/search/?text=b&text=a', 'https://yandex.ru/search/?text=a&text=b'), 'reversing duplicate query values is not equivalent');
const google = 'https://www.google.com/search?q=voice&start=10';
check(!expectedMatches(google + '&rnd=1', google) && !expectedMatches('https://www.google.com/search?start=10&q=voice', google), 'Google URL comparison retains existing strict behavior');
check(!expectedMatches('invalid', base) && !expectedMatches(undefined, base), 'malformed or missing expected URL input is rejected');
check(nextMatches(base.replace('p=1', 'p=2') + '&rnd=1', base), 'adjacent Yandex page retains context and permits rnd');
check(nextMatches('https://yandex.ru/search?text=вокал&p=1&rnd=2', 'https://yandex.ru/search/?text=вокал'), 'first Yandex next page advances omitted zero to one');
for (const [next, label] of [
  [base, 'same cursor'], [base.replace('p=1', 'p=3'), 'page skip'],
  [base.replace('p=1', 'p=0'), 'backward page'],
  [base.replace('p=1', 'p=2').replace('105422', '213'), 'next region change'],
  [base.replace('p=1', 'p=2') + '&filter=strict', 'next filter addition'],
  [base.replace('p=1', 'p=2').replace('уроки+вокала', 'other'), 'next query change'],
  [base.replace('p=1', 'p=2').replace('yandex.ru', 'yandex.com'), 'next origin change']
]) check(!nextMatches(next, base), `Yandex next-page validation rejects ${label}`);
async function workerBoundary(mutateDuringWrite) {
  let stored = { id: 'run', tabId: 7, mode: 'rank', engine: 'yandex', query: 'вокал', status: mutateDuringWrite ? 'waiting' : 'running', expectedUrl: 'https://yandex.ru/search/?text=вокал', pendingUrl: 'https://yandex.ru/search/?text=вокал&p=1', nextAt: 0, pagesVisited: 1, resultsSeen: 15, visitedUrls: [], seenUrls: [] };
  let actual = stored.expectedUrl + (mutateDuringWrite ? '' : '&rnd=2'), navigations = 0;
  const chrome = { runtime: { id: 'fixture', getURL: value => `chrome-extension://fixture/${value}` }, storage: { session: { get: async () => ({ seoRankRunState: stored }), set: async value => { stored = value.seoRankRunState; if (mutateDuringWrite) actual = 'https://yandex.ru/search/?text=вокал&rnd=changed-during-write'; } } }, tabs: { get: async () => ({ id: 7, url: actual }), update: async () => { navigations++; }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } } };
  const realm = vm.createContext({ URL, chrome }); vm.runInContext(source, realm); vm.runInContext(runner, realm);
  if (mutateDuringWrite) {
    const result = await realm.SeoRankRunner.dispatch({ action: 'getStatus' }, { id: 'fixture', url: 'chrome-extension://fixture/popup.html' });
    check(result.status === 'paused' && navigations === 0, 'actual document change during state write still blocks pending navigation');
  } else {
    const old = 'https://yandex.ru/search/?text=вокал&rnd=1';
    await assert.rejects(realm.SeoRankRunner.dispatch({ action: 'snapshot', runId: 'run' }, { id: 'fixture', url: old, tab: { id: 7, url: old } }), /Stale search tab message/);
    check(stored.resultsSeen === 15 && navigations === 0, 'semantically equivalent stale sender cannot impersonate current actual document');
  }
}
(async () => { await workerBoundary(true); await workerBoundary(false); console.log(`PASS ${checks} SERP URL identity and worker-boundary checks`); })().catch(error => { console.error(error); process.exitCode = 1; });
