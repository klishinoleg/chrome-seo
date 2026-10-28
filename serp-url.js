/* Expected Yandex results identity; actual document/sender trust stays strict. */
(function (root) {
  'use strict';
  const canonical = value => { try { const url = new URL(value); url.hash = ''; return url.href; } catch { return ''; } };
  function yandex(value) {
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || !/^(?:www\.)?yandex\.(?:ru|com)$/.test(url.hostname) || !/^\/search\/?$/.test(url.pathname)) return null;
    const cursors = url.searchParams.getAll('p');
    if (cursors.length > 1 || !/^\d{1,6}$/.test(cursors[0] ?? '0') || !url.searchParams.get('text')) return null;
    return { url, cursor: Number(cursors[0] ?? '0') };
  }
  function identity(info, omitCursor = false) {
    const url = new URL(info.url.href);
    url.hash = '';
    url.pathname = '/search/';
    url.searchParams.delete('rnd');
    if (omitCursor) url.searchParams.delete('p');
    // Stable key sorting retains the order of duplicate values.
    url.searchParams.sort();
    return url.href;
  }
  function expectedMatches(actual, expected) {
    const left = yandex(actual), right = yandex(expected);
    if (left && right) return identity(left) === identity(right);
    try {
      if ([actual, expected].some(value => /^(?:www\.)?yandex\.(?:ru|com)$/.test(new URL(value).hostname))) return false;
    } catch { return false; }
    const value = canonical(actual);
    return !!value && value === canonical(expected);
  }
  function nextMatches(value, current) {
    const next = yandex(value), previous = yandex(current);
    return !!next && !!previous && next.cursor === previous.cursor + 1 && identity(next, true) === identity(previous, true);
  }
  root.SeoSerpUrl = Object.freeze({ expectedMatches, nextMatches });
})(globalThis);
