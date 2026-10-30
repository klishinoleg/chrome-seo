/* Day grouping, pagination and conflict semantics without network or browser. */
const assert = require('node:assert/strict');
require('../gsc-history-model.js');
const m = globalThis.SeoGscHistoryModel;
let checks = 0, sequence = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log(`PASS ${label}`); };
const resource = 'https://example.com/sub/';
const row = (domain, links, targetPages = 1) => ({ domain, links, targetPages });
function capture(history, rows, at, start = 1, total = rows.length) {
  return m.append(history, {
    url: `https://search.google.com/search-console/links/drilldown?${new URLSearchParams({ resource_id: resource, type: 'DOMAIN' })}`,
    resourceId: resource, rows, coverage: { start: total ? start : 0, end: total ? start + rows.length - 1 : 0, total, complete: rows.length === total },
    filters: { clear: true, evidence: 'known-toolbar' }
  }, { id: `event_${++sequence}`, capturedAt: at });
}
const summary = history => m.summarize(history, Date.parse('2026-10-31T23:00:00.000Z'));
let h = capture(m.empty(resource), [row('a.example', 10), row('b.example', 20)], '2026-10-28T08:00:00.000Z');
check(h.days.length === 1 && h.workingDay.day === '2026-10-28', 'first complete observation creates one daily baseline');
h = capture(h, [row('a.example', 12), row('b.example', 20)], '2026-10-28T09:00:00.000Z');
check(h.days.length === 1 && summary(h).domains.find(x => x.domain === 'a.example').deltaLinks === 2, 'same-day changes update one day and retain initial baseline delta');
h = capture(h, [row('a.example', 12), row('b.example', 20)], '2026-10-28T10:00:00.000Z');
check(h.days.length === 1 && summary(h).unchangedCapture, 'same-day identical capture has no additional change or history row');
const firstSeen = h.firstSeen['a.example'];
h = capture(h, [row('a.example', 12), row('b.example', 20)], '2026-10-29T08:00:00.000Z');
check(h.days.length === 1 && h.workingDay.day === '2026-10-29' && summary(h).noChanges, 'unchanged next day only advances last checked time and working day');
h = capture(h, [row('a.example', 13)], '2026-10-30T08:00:00.000Z', 1, 2);
check(!h.workingDay.complete && summary(h).domains.find(x => x.domain === 'b.example').status === 'unconfirmed', 'partial day retains prior sources as unconfirmed rather than removed');
h = capture(h, [row('c.example', 5)], '2026-10-30T08:05:00.000Z', 2, 2);
let s = summary(h);
check(h.days.length === 2 && h.workingDay.complete && h.workingDay.rows.length === 2, 'different pagination captures form one changed day with complete coverage');
check(s.domains.find(x => x.domain === 'a.example').deltaLinks === 1 && s.domains.find(x => x.domain === 'c.example').status === 'new', 'daily changes use the previous observed day and mark first-ever source NEW');
check(s.domains.find(x => x.domain === 'b.example').status === 'removed', 'only complete same-total coverage confirms a removed source');
h = capture(h, [row('c.example', 5)], '2026-10-30T09:00:00.000Z', 2, 2);
check(h.days.length === 2 && summary(h).domains.find(x => x.domain === 'c.example').status === 'new', 'NEW persists after repeated captures within the same day');
h = capture(h, [row('a.example', 13), row('b.example', 2), row('c.example', 5)], '2026-10-31T08:00:00.000Z');
check(summary(h).domains.find(x => x.domain === 'b.example').status === 'returned' && h.firstSeen['a.example'] === firstSeen, 'reappearance is returned rather than NEW and first dates never reset');
check(m.dayMoscow('2026-10-30T21:00:00.000Z') === '2026-10-31' && m.dayMoscow('2026-10-30T20:59:59.999Z') === '2026-10-30', 'calendar boundary uses Europe/Moscow rather than UTC or machine timezone');
const base = capture(m.empty(resource), [row('a.example', 10)], '2026-10-28T08:00:00.000Z', 1, 2);
const left = capture(base, [row('b.example', 20)], '2026-10-28T09:00:00.000Z', 2, 2);
const right = capture(base, [row('a.example', 15)], '2026-10-28T10:00:00.000Z', 1, 2);
const merged = m.merge(left, right);
check(merged.days.length === 1 && merged.workingDay.complete && merged.workingDay.rows.find(x => x.domain === 'a.example').links === 15, 'concurrent folder branches union daily captures and preserve latest counts');
check(JSON.stringify(m.merge(left, right)) === JSON.stringify(m.merge(right, left)), 'folder merge is deterministic independent of branch order');
let resized = capture(left, [row('a.example', 11)], '2026-10-28T11:00:00.000Z', 1, 3);
check(!resized.workingDay.complete && resized.workingDay.collected === 1 && resized.workingDay.total === 3, 'changed total resets coverage proof while retaining observations');
resized = capture(resized, [row('c.example', 30)], '2026-10-28T12:00:00.000Z', 3, 3);
check(!resized.workingDay.complete && resized.workingDay.collected === 2, 'old-total second page cannot fill a gap in current-total coverage');
resized = capture(resized, [row('b.example', 20)], '2026-10-28T13:00:00.000Z', 2, 3);
check(resized.workingDay.complete && resized.workingDay.rows.length === 3, 'only all positions in the current total confirm the full daily collection');
const conflict = JSON.parse(JSON.stringify(left)); conflict.events[0].rows[0].links = 999;
assert.throws(() => m.merge(left, conflict)); checks++; console.log('PASS altered immutable event or derived history is rejected');
assert.throws(() => m.merge(left, m.empty('https://other.example/'))); checks++; console.log('PASS another property cannot be merged into this resource file');
check(m.resourceId('https://example.com/sub/') !== m.resourceId('https://example.com/'), 'URL-prefix resources retain distinct paths');
Promise.all([m.fileName(resource), m.fileName('https://example.com/'), m.fileName('sc-domain:example.com')]).then(names => {
  check(new Set(names).size === 3 && names.every(name => /^gsc-history-[a-f0-9]{64}\.json$/.test(name)), 'resource-specific hashed names are separate and contain no path traversal');
  console.log(`PASS ${checks} Search Console daily model checks`);
}).catch(error => { console.error(error); process.exitCode = 1; });
