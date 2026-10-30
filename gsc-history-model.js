/* Moscow-day GSC observations, accumulated from explicit unfiltered page captures. */
(function (root) {
  'use strict';
  const SCHEMA_VERSION = 1;
  const LIMIT = Object.freeze({ rows: 100000, events: 10000, bytes: 32000000 });
  const fail = message => { throw new Error(message); };
  function fields(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(`Invalid ${label}`);
  }
  function text(value, label, max = 8192) {
    if (typeof value !== 'string' || !value || value.length > max) fail(`Invalid ${label}`);
    return value;
  }
  function domain(value) {
    text(value, 'domain', 253);
    if (value !== value.trim() || /[\s/@?#:\\]/.test(value)) fail('Invalid referring domain');
    let host;
    try { host = new URL(`https://${value}`).hostname.toLowerCase().replace(/\.$/, ''); } catch { fail('Invalid referring domain'); }
    if (!host.includes('.') || host.length > 253 || host.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) fail('Invalid referring domain');
    return host;
  }
  function resourceId(value) {
    text(value, 'Search Console resource');
    if (value.startsWith('sc-domain:')) {
      if (`sc-domain:${domain(value.slice(10))}` !== value) fail('Domain property must use its exact canonical resource ID');
      return value;
    }
    let url;
    try { url = new URL(value); } catch { fail('Invalid URL-prefix resource'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search || value !== value.trim()) fail('Invalid URL-prefix resource');
    domain(url.hostname); return value;
  }
  function page(value) {
    let url;
    try { url = new URL(value); } catch { fail('Unsupported Search Console page'); }
    if (url.origin !== 'https://search.google.com' || url.username || url.password || !/^\/search-console\/links\/drilldown\/?$/.test(url.pathname) || url.searchParams.getAll('resource_id').length !== 1 || url.searchParams.getAll('type').length !== 1 || url.searchParams.get('type') !== 'DOMAIN' || [...url.searchParams.keys()].some(key => !['resource_id', 'type', 'target', 'domain', 'hl', 'authuser'].includes(key)) || ['target', 'domain', 'hl', 'authuser'].some(key => url.searchParams.getAll(key).length > 1) || ['target', 'domain'].some(key => (url.searchParams.get(key) || '') !== '') || url.searchParams.has('authuser') && !/^\d+$/.test(url.searchParams.get('authuser'))) fail('Open the unfiltered referring-domain aggregate report');
    return { url: url.href, resourceId: resourceId(url.searchParams.get('resource_id')) };
  }
  function count(value) {
    if (!Number.isSafeInteger(value) || value < 0) fail('Invalid GSC count');
    return value;
  }
  function rows(value, sort = true) {
    if (!Array.isArray(value) || value.length > LIMIT.rows) fail('Invalid GSC domain rows');
    const seen = new Set();
    const result = value.map(row => {
      fields(row, ['domain', 'links', 'targetPages'], 'GSC row');
      const host = domain(row.domain);
      if (seen.has(host)) fail('Duplicate referring domain');
      seen.add(host); return { domain: host, links: count(row.links), targetPages: count(row.targetPages) };
    });
    return sort ? result.sort((a, b) => a.domain.localeCompare(b.domain, 'en')) : result;
  }
  function coverage(value, length) {
    fields(value, ['start', 'end', 'total', 'complete'], 'GSC coverage');
    const total = count(value.total), start = count(value.start), end = count(value.end);
    if (total > LIMIT.rows || (total ? start < 1 || end < start || end > total || end - start + 1 !== length : start !== 0 || end !== 0 || length !== 0)) fail('Invalid GSC page coverage');
    const complete = total === 0 || start === 1 && end === total;
    if (value.complete !== complete) fail('GSC completeness does not match the observed range');
    return { start, end, total, complete };
  }
  function snapshot(value) {
    fields(value, ['url', 'resourceId', 'rows', 'coverage', 'filters'], 'GSC snapshot');
    const source = page(value.url);
    if (resourceId(value.resourceId) !== source.resourceId) fail('Snapshot resource does not match its page');
    fields(value.filters, ['clear', 'evidence'], 'GSC filter proof');
    if (value.filters.clear !== true || value.filters.evidence !== 'known-toolbar') fail('Clear all filters before capturing');
    const result = rows(value.rows, false);
    return { ...source, rows: result, coverage: coverage(value.coverage, result.length), filters: { clear: true, evidence: 'known-toolbar' } };
  }
  function date(value) {
    text(value, 'observation time', 30);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('Invalid observation time');
    return value;
  }
  function dayMoscow(value) {
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
    const part = name => parts.find(item => item.type === name).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function event(value) {
    fields(value, ['id', 'capturedAt', 'rows', 'coverage'], 'capture event');
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(text(value.id, 'event ID', 128))) fail('Invalid capture event ID');
    const result = rows(value.rows, false);
    return { id: value.id, capturedAt: date(value.capturedAt), rows: result, coverage: coverage(value.coverage, result.length) };
  }
  function firstObservations(events) {
    const result = {};
    for (const item of events) for (const row of item.rows) if (!result[row.domain] || item.capturedAt < result[row.domain]) result[row.domain] = item.capturedAt;
    return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b, 'en')));
  }
  const equalRows = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function project(events) {
    const groups = new Map();
    for (const item of events) {
      const day = dayMoscow(item.capturedAt);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(item);
    }
    let baseline = [], baselineDay = null, workingDay = null;
    const days = [];
    for (const [day, captures] of groups) {
      const observed = new Map(), slots = new Map();
      let total = null;
      for (const capture of captures) {
        if (capture.coverage.total !== total) { total = capture.coverage.total; slots.clear(); }
        capture.rows.forEach((row, index) => {
          observed.set(row.domain, row);
          slots.set(capture.coverage.start + index, row.domain);
        });
      }
      const slotDomains = new Set(slots.values());
      const complete = total === 0 || slots.size === total && slotDomains.size === total && [...slots.keys()].every(index => index >= 1 && index <= total);
      const effective = new Map(complete ? [] : baseline.map(row => [row.domain, row]));
      for (const [host, row] of observed) if (!complete || slotDomains.has(host)) effective.set(host, row);
      const result = rows([...effective.values()]);
      workingDay = { day, baselineDay, capturedAt: captures[0].capturedAt, lastCheckedAt: captures.at(-1).capturedAt, rows: result, complete, collected: complete ? total : slotDomains.size, total };
      if (baselineDay === null || !equalRows(result, baseline)) {
        const { baselineDay: ignored, ...materialized } = workingDay;
        days.push(materialized);
      }
      baseline = result; baselineDay = day;
    }
    return { days, workingDay };
  }
  function build(resource, events) {
    const ordered = [...events].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id));
    return { schemaVersion: SCHEMA_VERSION, resourceId: resource, events: ordered, firstSeen: firstObservations(ordered), ...project(ordered) };
  }
  function empty(resource) { return build(resourceId(resource), []); }
  function validateHistory(value, expectedResource) {
    fields(value, ['schemaVersion', 'resourceId', 'events', 'firstSeen', 'days', 'workingDay'], 'GSC history');
    const resource = resourceId(value.resourceId);
    if (value.schemaVersion !== SCHEMA_VERSION || expectedResource !== undefined && resource !== resourceId(expectedResource) || !Array.isArray(value.events) || value.events.length > LIMIT.events || JSON.stringify(value).length > LIMIT.bytes) fail('Invalid GSC history schema or resource');
    const ids = new Set();
    const events = value.events.map(item => {
      const result = event(item);
      if (ids.has(result.id)) fail('Duplicate capture event ID');
      ids.add(result.id); return result;
    });
    const result = build(resource, events);
    if (JSON.stringify(value.firstSeen) !== JSON.stringify(result.firstSeen) || JSON.stringify(value.days) !== JSON.stringify(result.days) || JSON.stringify(value.workingDay) !== JSON.stringify(result.workingDay)) fail('Daily aggregates or first observations do not match immutable events');
    return result;
  }
  function append(history, observation, metadata) {
    const current = validateHistory(history), capture = snapshot(observation);
    if (capture.resourceId !== current.resourceId) fail('Capture belongs to another resource');
    const next = event({ id: metadata.id, capturedAt: metadata.capturedAt, rows: capture.rows, coverage: capture.coverage });
    if (current.events.some(item => item.id === next.id)) fail('Capture event ID already exists');
    return validateHistory(build(current.resourceId, [...current.events, next]));
  }
  function merge(local, incoming) {
    const result = validateHistory(local), addition = validateHistory(incoming, result.resourceId);
    const events = new Map(result.events.map(item => [item.id, item]));
    for (const item of addition.events) {
      const existing = events.get(item.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(item)) fail('Conflicting immutable event ID; folder file unchanged');
      events.set(item.id, item);
    }
    return validateHistory(build(result.resourceId, [...events.values()]));
  }
  function summarize(history, now = Date.now()) {
    const current = validateHistory(history), working = current.workingDay;
    if (!working) return { measurementCount: 0, day: dayMoscow(now), baselineDay: null, lastCheckedAt: null, previousCheckedAt: null, noChanges: false, complete: false, collected: 0, total: null, domains: [] };
    const prior = current.events.filter(item => dayMoscow(item.capturedAt) < working.day);
    const priorWorking = project(prior).workingDay;
    const baseline = new Map((priorWorking?.rows || current.events[0].rows).map(row => [row.domain, row]));
    const latest = new Map(working.rows.map(row => [row.domain, row]));
    const observedToday = new Set(current.events.filter(item => dayMoscow(item.capturedAt) === working.day).flatMap(item => item.rows.map(row => row.domain)));
    const domains = Object.entries(current.firstSeen).map(([host, firstSeenAt]) => {
      const row = latest.get(host), before = baseline.get(host), confirmed = working.complete || observedToday.has(host);
      const links = row?.links ?? 0, targetPages = row?.targetPages ?? 0;
      const sameCounts = !!row && !!before && row.links === before.links && row.targetPages === before.targetPages;
      const status = !confirmed ? 'unconfirmed' : !row ? before ? 'removed' : 'absent' : !priorWorking && before && sameCounts ? 'baseline' : dayMoscow(firstSeenAt) === working.day && !before ? 'new' : !before ? 'returned' : sameCounts ? 'unchanged' : 'changed';
      return { domain: host, links, targetPages, firstSeenAt, elapsedMs: Math.max(0, now - Date.parse(firstSeenAt)), deltaLinks: links - (before?.links ?? 0), deltaTargetPages: targetPages - (before?.targetPages ?? 0), status, observed: confirmed };
    });
    const previous = project(current.events.slice(0, -1)).workingDay;
    return { measurementCount: current.days.length, day: working.day, baselineDay: working.baselineDay, lastCheckedAt: working.lastCheckedAt, previousCheckedAt: priorWorking?.lastCheckedAt ?? null, noChanges: equalRows(working.rows, rows([...baseline.values()])), unchangedCapture: !!previous && equalRows(working.rows, previous.rows), complete: working.complete, collected: working.collected, total: working.total, domains };
  }
  async function fileName(resource) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(resourceId(resource)));
    return `gsc-history-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}.json`;
  }
  root.SeoGscHistoryModel = Object.freeze({ SCHEMA_VERSION, LIMIT, domain, resourceId, page, rows, snapshot, empty, validateHistory, append, merge, summarize, dayMoscow, fileName });
})(globalThis);
