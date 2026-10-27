/* Conservative, ordered organic-result extraction. No navigation or network. */
(() => {
 'use strict';
 const engineOf = host => /^(?:www\.)?google\.(?:com|ru)$/.test(host) ? 'google' : /^(?:www\.)?yandex\.(?:com|ru)$/.test(host) ? 'yandex' : null;
 function destination(anchor) {
  try {
   let url = new URL(anchor.href, location.href);
   if (!/^https?:$/.test(url.protocol)) return null;
   if (engineOf(url.hostname) === 'google' && url.pathname === '/url') url = new URL(url.searchParams.get('q') || url.searchParams.get('url') || '');
   // Opaque Yandex click/tracking URLs cannot safely identify the destination.
   if (/^clck\.yandex\.(?:ru|com)$/.test(url.hostname)) return null;
   if (engineOf(url.hostname) && /^\/(?:url|search|sorry|showcaptcha|captcha|clck)(?:\/|$)/.test(url.pathname)) return null;
   return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch { return null; }
 }
 function snapshot() {
  const url = new URL(location.href), engine = engineOf(url.hostname);
  const query = url.searchParams.get(engine === 'google' ? 'q' : 'text') || '';
  const offset = Number(url.searchParams.get(engine === 'google' ? 'start' : 'p') || 0);
  const page = engine === 'google' ? Math.floor(offset / 10) + 1 : offset + 1;
  const base = {kind:'unknown',url:url.href,engine,query,page,results:[],nextUrl:null,nextKind:'none'};
  if (!engine) return base;
  if (/\/sorry(?:\/|$)|\/showcaptcha|\/captcha/.test(url.pathname) || document.querySelector('#captcha-form, .CheckboxCaptcha, .SmartCaptcha, [id*="captcha"], iframe[src*="recaptcha"]')) return {...base,kind:'captcha'};
  if (document.querySelector('form[action*="consent"], #consent-bump, .consent-bump') || /consent/.test(url.pathname)) return {...base,kind:'consent'};
  if (!/^\/search\/?$/.test(url.pathname) || !query || !Number.isInteger(offset) || offset < 0) return base;
  const candidates = engine === 'google' ? document.querySelectorAll('#rso .MjjYud h3, #rso .g h3') : document.querySelectorAll('.serp-item .Organic h2 a, .serp-item .OrganicTitle-Link, .serp-item .organic__title a');
  const cards = new Set();
  for (const title of candidates) {
   if (!title.getClientRects().length || getComputedStyle(title).visibility === 'hidden' || title.closest('[hidden], [aria-hidden="true"]')) continue;
   const anchor = title.closest('a[href]');
   if (!anchor || anchor.closest('#tads, #bottomads, [data-text-ad], [data-ad], .serp-item_type_adv, .Adv, .RelatedSearches, .related-question-pair, .commercial-unit-desktop-top, [data-attrid="People also ask"]')) continue;
   const card = engine === 'google' ? title.closest('.g') || title.closest('.MjjYud') : title.closest('.serp-item');
   if (!card || cards.has(card) || card.querySelector('[data-text-ad], .OrganicLabel_type_adv, .Label_type_adv, .organic__label_type_ad')) continue;
   // An unresolved organic destination still occupies a displayed rank slot.
   // Pausing avoids moving all following results upward in the reported order.
   const href = destination(anchor); if (!href) return {...base,kind:'unknown',results:[],nextUrl:null};
   cards.add(card); base.results.push({url:href});
  }
  if (!base.results.length) return base;
  base.kind = 'results';
  const next = document.querySelector(engine === 'google' ? 'a#pnnext' : 'a.Pager-Item_type_next, a.pager__item_kind_next');
  if (next) {
   base.nextKind = 'invalid';
   try {
    const target = new URL(next.href, url);
    const nextOffset = Number(target.searchParams.get(engine === 'google' ? 'start' : 'p'));
    if (target.protocol === 'https:' && engineOf(target.hostname) === engine && /^\/search\/?$/.test(target.pathname) && target.searchParams.get(engine === 'google' ? 'q' : 'text') === query && Number.isInteger(nextOffset) && nextOffset > offset) { base.nextUrl = target.href; base.nextKind = 'valid'; }
   } catch { /* Unknown links never become navigation instructions. */ }
  }
  return base;
 }
 globalThis.SeoSerpParser = Object.freeze({snapshot});
})();
