(() => {
  'use strict';

  // This function is deliberately self-contained: Chrome serializes it for injection.
  async function collect() {
    const url = location.href;
    const unknown = error => ({ status: 'unknown', httpStatus: null, error });
    let target;
    try {
      target = new URL(url);
      if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Поддерживаются только HTTP и HTTPS');
    } catch (error) {
      return { url, robots: { ...unknown(String(error.message)), text: '' }, page: { ...unknown(String(error.message)), xRobotsTag: '' } };
    }
    async function request(isRobots) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      let reader;
      try {
        const response = await fetch(isRobots ? new URL('/robots.txt', target).href : url, {
          method: isRobots ? 'GET' : 'HEAD', credentials: 'same-origin',
          redirect: 'error', cache: 'no-store', signal: controller.signal
        });
        const httpStatus = response.status;
        if (response.type === 'opaqueredirect' || (response.url && new URL(response.url).origin !== target.origin)) {
          return { status: 'unknown', httpStatus, error: 'Перенаправление не проверено' };
        }
        if (isRobots && [404, 410].includes(httpStatus)) return { status: 'absent', httpStatus, text: '' };
        if ((!isRobots && httpStatus !== 200) || (isRobots && (httpStatus < 200 || httpStatus >= 300 || httpStatus === 206))) {
          return { status: 'unknown', httpStatus, error: `HTTP ${httpStatus}` };
        }
        if (!isRobots) return { status: 'ok', httpStatus, xRobotsTag: response.headers.get('x-robots-tag') || '' };
        const limit = 512000;
        if (Number(response.headers.get('content-length')) > limit) return { status: 'unknown', httpStatus, error: 'robots.txt превышает лимит 500 КиБ' };
        if (/text\/html/i.test(response.headers.get('content-type') || '')) return { status: 'unknown', httpStatus, error: 'Вместо robots.txt получен HTML' };
        if (!response.body) return { status: 'ok', httpStatus, text: '' };
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0, text = '';
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > limit) return { status: 'unknown', httpStatus, error: 'robots.txt превышает лимит 500 КиБ' };
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
        if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) return { status: 'unknown', httpStatus, error: 'Вместо robots.txt получен HTML' };
        return { status: 'ok', httpStatus, text };
      } catch (error) {
        return unknown(error.name === 'AbortError' ? 'Истекло время ожидания' : 'Запрос недоступен или перенаправлен');
      } finally {
        clearTimeout(timer);
        if (reader) { try { await reader.cancel(); } catch { /* Already closed. */ } }
        controller.abort();
      }
    }
    const [robots, page] = await Promise.all([request(true), request(false)]);
    return { url, robots: { text: '', ...robots }, page: { xRobotsTag: '', ...page } };
  }

  function normalize(value) {
    // Decode only unreserved ASCII; reserved escapes must keep their meaning.
    return String(value).replace(/%[\da-f]{2}|[^\x00-\x7F]/giu, token => {
      if (token[0] !== '%') return encodeURIComponent(token);
      const char = String.fromCharCode(parseInt(token.slice(1), 16));
      return /[A-Za-z0-9._~-]/.test(char) ? char : token.toUpperCase();
    });
  }

  function groups(text) {
    const result = [];
    let group = null, hasRules = false;
    for (const raw of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const line = raw.split('#')[0].trim();
      const match = /^([^:]+):\s*(.*)$/.exec(line);
      if (!match) continue;
      const key = match[1].trim().toLowerCase(), value = match[2].trim();
      if (key === 'user-agent') {
        if (!group || hasRules) { group = { agents: [], rules: [] }; result.push(group); hasRules = false; }
        group.agents.push(value.toLowerCase());
      } else if (group && ['allow', 'disallow'].includes(key)) {
        hasRules = true;
        if (value && value.startsWith('/')) group.rules.push({ allow: key === 'allow', path: normalize(value) });
      }
    }
    return result;
  }

  function agentSpecificity(agent, bot) {
    if (agent === '*') return 0;
    // Version/suffix wildcard is ignored, but Googlebot-news is a distinct bot.
    const token = agent.split(/[/*\s]/)[0];
    if (bot === 'yandex' && token === 'yandexbot') return token.length;
    return token === bot ? token.length : -1;
  }

  function crawlRule(parsed, bot, path) {
    let specificity = -1, rules = [];
    for (const group of parsed) {
      const score = Math.max(-1, ...group.agents.map(agent => agentSpecificity(agent, bot)));
      if (score < 0 || score < specificity) continue;
      if (score > specificity) { specificity = score; rules = []; }
      rules.push(...group.rules);
    }
    let winner = null;
    for (const rule of rules) {
      const terminal = rule.path.endsWith('$');
      const body = terminal ? rule.path.slice(0, -1) : rule.path;
      const pattern = body.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
      if (!new RegExp(`^${pattern}${terminal ? '$' : ''}`).test(path)) continue;
      if (!winner || rule.path.length > winner.path.length || (rule.path.length === winner.path.length && rule.allow)) winner = rule;
    }
    return winner;
  }

  function headerDirectives(value) {
    const entries = [];
    const known = new Set(['noindex', 'none', 'index', 'follow', 'nofollow', 'noarchive', 'nosnippet', 'noimageindex', 'notranslate', 'unavailable_after', 'max-snippet', 'max-image-preview', 'max-video-preview', 'indexifembedded', 'all', 'nocache']);
    for (const header of Array.isArray(value) ? value : [value || '']) {
      let agent = 'robots';
      for (const raw of String(header).split(',')) {
        let directive = raw.trim();
        const prefix = /^([\w*-]+)\s*:\s*(.*)$/.exec(directive);
        if (prefix && !known.has(prefix[1].toLowerCase())) { agent = prefix[1].toLowerCase(); directive = prefix[2]; }
        entries.push({ name: agent, content: directive });
      }
    }
    return entries;
  }

  function evaluate(snapshot = {}, signals = {}) {
    const labels = { allowed: 'Индексация разрешена', noindex: 'Есть noindex', blocked: 'Обход закрыт', partial: 'Проверка неполная' };
    const reasons = ['Область проверки: Googlebot и Yandex; наличие URL в поисковом индексе неизвестно.', 'X-Robots-Tag проверен отдельным новым HEAD-запросом, а не по ответу исходной навигации.'];
    const robots = signals.robots || {}, page = signals.page || {};
    const meta = Array.isArray(snapshot.robotMeta) ? snapshot.robotMeta : [{ name: 'robots', content: snapshot.robots || '' }];
    const headers = headerDirectives(page.xRobotsTag);
    let partial = !['ok', 'absent'].includes(robots.status) || page.status !== 'ok' || page.httpStatus !== 200;
    let target;
    try { target = new URL(snapshot.url || signals.url); if (!['http:', 'https:'].includes(target.protocol)) target = null; } catch { target = null; }
    if (!target) { partial = true; reasons.push('URL страницы недоступен для проверки.'); }
    if (signals.url && snapshot.url && signals.url !== snapshot.url) { partial = true; reasons.push('URL сетевой проверки отличается от снимка страницы.'); }
    if (!['ok', 'absent'].includes(robots.status)) reasons.push(`robots.txt: ${robots.error || 'не удалось проверить'}.`);
    if (page.status !== 'ok' || page.httpStatus !== 200) reasons.push(`HEAD страницы: ${page.error || (page.httpStatus ? `HTTP ${page.httpStatus}` : 'не удалось проверить')}.`);
    const parsed = groups(robots.text);
    const bots = [['Googlebot', 'googlebot'], ['Yandex', 'yandex']].map(([name, bot]) => {
      const botReasons = [];
      let noindex = false, unavailableAfter = false;
      for (const [source, entries] of [['meta', meta], ['X-Robots-Tag', headers]]) {
        for (const entry of entries) {
          const scope = String(entry.name || '').toLowerCase().trim();
          if (!['robots', '*', bot].includes(scope)) continue;
          if (/(?:^|[\s,;])unavailable_after\s*:/i.test(String(entry.content || ''))) {
            unavailableAfter = true; partial = true;
            botReasons.push(`${name}: ${source} (${scope}) содержит unavailable_after; срок доступности для индексации требует отдельной проверки даты.`);
          }
          if (/(?:^|[\s,;])(noindex|none)(?:$|[\s,;])/i.test(String(entry.content || ''))) {
            noindex = true; botReasons.push(`${name}: ${source} (${scope}) запрещает индексацию (noindex/none).`);
          }
        }
      }
      let crawlAllowed = null;
      if (robots.status === 'absent') { crawlAllowed = true; botReasons.push(`${name}: robots.txt отсутствует (HTTP ${robots.httpStatus}), запрет обхода не найден.`); }
      if (robots.status === 'ok' && target) {
        const rule = crawlRule(parsed, bot, normalize(target.pathname + target.search));
        crawlAllowed = !rule || rule.allow;
        botReasons.push(`${name}: robots.txt ${rule ? `${rule.allow ? 'Allow' : 'Disallow'}: ${rule.path}` : 'не запрещает этот URL'}.`);
      }
      if (crawlAllowed === false) botReasons.push(`${name}: запрет обхода не гарантирует удаления URL из индекса; noindex может быть недоступен роботу.`);
      if (!noindex) botReasons.push(`${name}: применимый noindex в META${page.status === 'ok' ? ' и HEAD X-Robots-Tag не найден' : ' не найден; X-Robots-Tag не проверен'}.`);
      return { name, indexingAllowed: noindex ? false : !unavailableAfter && page.status === 'ok' && page.httpStatus === 200 ? true : null, crawlAllowed, reasons: botReasons };
    });
    const state = bots.some(bot => bot.indexingAllowed === false) ? 'noindex' : bots.some(bot => bot.crawlAllowed === false) ? 'blocked' : partial ? 'partial' : 'allowed';
    reasons.push(...bots.flatMap(bot => bot.reasons));
    return { state, label: labels[state], reasons, bots };
  }

  globalThis.SeoIndexability = Object.freeze({ collect, evaluate });
})();
