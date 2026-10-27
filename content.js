(() => {
  'use strict';
  if (globalThis.__chromeSeo) return;
  const palette = ['#ffe066', '#80ed99', '#90dbf4', '#ff99c8', '#cdb4db', '#ffbf69'];
  const colorFor = index => palette[index] || `hsl(${(index * 137.50776405003785) % 360} 78% 76%)`;
  const owned = new Set();
  let sheet;
  const excluded = 'script,style,noscript,template,[hidden],[inert],[aria-hidden="true"]';
  const block = /^(block|flex|grid|table|list-item|flow-root)/;
  function visible(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || el.closest(excluded)) return false;
    for (; el; el = el.parentElement) {
      const css = getComputedStyle(el);
      if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse' || css.contentVisibility === 'hidden') return false;
    }
    return true;
  }
  function stream(root) {
    const parts = [];
    let text = '', lastBlock;
    if (!root) return { text, parts };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (!visible(node)) continue;
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'BR') text += '\n';
        continue;
      }
      let owner = node.parentElement;
      while (owner && owner !== root && !block.test(getComputedStyle(owner).display)) owner = owner.parentElement;
      if (parts.length && owner !== lastBlock) text += '\n';
      parts.push({ node, start: text.length, end: text.length + node.data.length });
      text += node.data;
      lastBlock = owner;
    }
    return { text, parts };
  }
  const wordsIn = text => (text.match(/[\p{L}\p{N}\p{M}_]+/gu) || []).length;
  function matcher(word) {
    return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}\\p{M}_])`, 'giu');
  }
  const count = (text, word) => [...text.matchAll(matcher(word))].length;
  function inputs(input) {
    const seen = new Set();
    return String(input || '').trim().split(/\s+/u).filter(word => {
      const key = word.toLowerCase();
      if (!word || seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  const meta = name => [...document.querySelectorAll('meta[name]')].filter(el => el.name.toLowerCase() === name).map(el => el.content).join(', ');
  function links() {
    const pageNofollow = /(?:^|[\s,;])(nofollow|none)(?:$|[\s,;])/i.test(['robots', 'googlebot', 'yandex'].map(meta).join(', '));
    const entries = [];
    for (const anchor of document.querySelectorAll('a[href]')) {
      let url;
      try { url = new URL(anchor.getAttribute('href'), document.baseURI); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol) || url.hostname === location.hostname) continue;
      entries.push({ anchor, url: url.href, domain: url.hostname, text: stream(anchor).text.trim(), rel: anchor.getAttribute('rel') || '', restricted: pageNofollow || /(?:^|[\s,])(nofollow|ugc|sponsored)(?:$|[\s,])/i.test(anchor.getAttribute('rel') || '') });
    }
    return { pageNofollow, entries };
  }
  function analyze() {
    const external = links();
    return {
      url: location.href, hostname: location.hostname, title: document.title,
      description: meta('description'), canonical: document.querySelector('link[rel~="canonical"]')?.href || '',
      robots: ['robots', 'googlebot', 'yandex'].map(meta).filter(Boolean).join(', '), lang: document.documentElement.lang,
      robotMeta: [...document.querySelectorAll('meta[name]')].filter(el => ['robots', 'googlebot', 'yandex'].includes(el.name.toLowerCase())).map(el => ({ name: el.name.toLowerCase(), content: el.content })),
      openGraph: [...document.querySelectorAll('meta[property]')].filter(el => el.getAttribute('property').toLowerCase().startsWith('og:')).map(el => ({ property: el.getAttribute('property'), content: el.content })),
      headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map(el => ({ tag: el.tagName.toLowerCase(), text: stream(el).text.trim() })),
      images: [...document.images].map(el => ({ src: el.currentSrc || el.src, alt: el.getAttribute('alt') || '', hasAlt: el.hasAttribute('alt') })),
      wordCount: wordsIn(stream(document.body).text), pageNofollow: external.pageNofollow,
      links: external.entries.map(({ anchor, ...entry }) => entry),
      micro: {
        jsonLd: [...document.querySelectorAll('script[type]')].filter(el => el.type.toLowerCase() === 'application/ld+json').map(el => {
          const raw = el.textContent;
          try { return { raw, data: JSON.parse(raw), error: null }; } catch (error) { return { raw, data: null, error: String(error.message) }; }
        }),
        microdata: [...document.querySelectorAll('[itemscope]')].map(el => ({ type: el.getAttribute('itemtype') || '', id: el.getAttribute('itemid') || '', properties: [...el.querySelectorAll('[itemprop]')].filter(prop => prop.parentElement?.closest('[itemscope]') === el).flatMap(prop => (prop.getAttribute('itemprop') || '').split(/\s+/).filter(Boolean).map(name => ({ name, value: prop.hasAttribute('itemscope') ? (prop.getAttribute('itemid') || prop.getAttribute('itemtype') || '') : prop.getAttribute('content') ?? prop.getAttribute('datetime') ?? prop.getAttribute('href') ?? prop.getAttribute('src') ?? prop.textContent.trim() }))) })),
        rdfa: [...document.querySelectorAll('[typeof],[property],[about]')].filter(el => el.tagName !== 'META' || !el.getAttribute('property')?.startsWith('og:')).map(el => ({ tag: el.tagName.toLowerCase(), about: el.getAttribute('about') || '', typeof: el.getAttribute('typeof') || '', property: el.getAttribute('property') || '', content: el.getAttribute('content') ?? el.textContent.trim() }))
      }
    };
  }
  function keywords(input) {
    const body = stream(document.body);
    const words = inputs(input).map((word, index) => {
      const result = { word, color: colorFor(index), total: 0, title: count(document.title, word), meta: count([...document.querySelectorAll('meta[content]')].map(el => el.content).join('\n'), word), h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0, body: count(body.text, word), p: 0, a: 0, other: 0 };
      for (const tag of ['h1','h2','h3','h4','h5','h6','p','a']) {
        result[tag] = [...document.querySelectorAll(tag)].reduce((sum, el) => sum + count(stream(el).text, word), 0);
      }
      for (const match of body.text.matchAll(matcher(word))) {
        const part = body.parts.find(part => part.start <= match.index && part.end > match.index);
        if (!part?.node.parentElement.closest('p,a,h1,h2,h3,h4,h5,h6')) result.other++;
      }
      result.total = result.body;
      return result;
    });
    return { words, wordCount: wordsIn(body.text) };
  }
  function clearHighlights() {
    if (globalThis.CSS?.highlights) for (const name of owned) CSS.highlights.delete(name);
    owned.clear(); sheet?.remove(); sheet = undefined;
    return { cleared: true };
  }
  function setup() {
    clearHighlights();
    if (!globalThis.CSS?.highlights || typeof Highlight !== 'function') return false;
    sheet = document.createElement('style');
    (document.head || document.documentElement).append(sheet);
    return true;
  }
  function register(name, ranges, color) {
    owned.add(name); CSS.highlights.set(name, new Highlight(...ranges));
    sheet.textContent += `::highlight(${name}) { background-color: ${color}; color: #111; }\n`;
  }
  function highlightKeywords(input) {
    if (!setup()) return { supported: false, count: 0, message: 'CSS Custom Highlight API недоступен' };
    const body = stream(document.body);
    let total = 0;
    inputs(input).forEach((word, index) => {
      const ranges = [];
      for (const match of body.text.matchAll(matcher(word))) {
        const start = body.parts.find(part => part.start <= match.index && part.end > match.index);
        const endIndex = match.index + match[0].length;
        const end = body.parts.find(part => part.start < endIndex && part.end >= endIndex);
        if (!start || !end) continue;
        const range = document.createRange();
        range.setStart(start.node, match.index - start.start); range.setEnd(end.node, endIndex - end.start);
        ranges.push(range);
      }
      total += ranges.length; register(`chrome-seo-key-${index}`, ranges, colorFor(index));
    });
    return { supported: true, count: total };
  }
  function highlightLinks(domainFilter) {
    if (!setup()) return { supported: false, count: 0, message: 'CSS Custom Highlight API недоступен' };
    const groups = [[], []];
    let firstRendered;
    for (const entry of links().entries) {
      if (!entry.domain.toLowerCase().includes(String(domainFilter || '').toLowerCase()) || !visible(entry.anchor)) continue;
      const range = document.createRange(); range.selectNodeContents(entry.anchor); groups[Number(entry.restricted)].push(range);
      if (!firstRendered && [...entry.anchor.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) {
        let transparent = false;
        for (let el = entry.anchor; el; el = el.parentElement) {
          if (Number(getComputedStyle(el).opacity) === 0) { transparent = true; break; }
        }
        if (!transparent) firstRendered = entry.anchor;
      }
    }
    register('chrome-seo-link-open', groups[0], '#80ed99'); register('chrome-seo-link-restricted', groups[1], '#ff8c94');
    firstRendered?.scrollIntoView({ block: 'center', inline: 'nearest' });
    return { supported: true, count: groups[0].length + groups[1].length };
  }
  globalThis.__chromeSeo = Object.freeze({ analyze, keywords, highlightKeywords, highlightLinks, clearHighlights });
})();
