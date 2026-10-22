/* Local-only highlighting on the supported search engine result pages. */
(() => {
  'use strict';
  const MARK = 'data-seo-lens-result';
  const UI = 'data-seo-lens-search-ui';
  let targetDomain = '';
  let dismissed = false;
  let scheduled;
  let panel;
  let label;
  const normalizeDomain = value => {
    try {
      const raw = String(value || '').trim();
      if (!raw) return '';
      const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
      return /^https?:$/.test(url.protocol) ? url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '') : '';
    } catch { return ''; }
  };
  const destination = anchor => {
    try {
      let url = new URL(anchor.href, location.href);
      if (!/^https?:$/.test(url.protocol)) return null;
      if (/^(?:www\.)?google\.(?:com|ru)$/.test(url.hostname) && url.pathname === '/url') {
        const redirect = url.searchParams.get('q') || url.searchParams.get('url');
        if (redirect) url = new URL(redirect);
      }
      return /^https?:$/.test(url.protocol) ? url : null;
    } catch { return null; }
  };
  const clearMarks = () => document.querySelectorAll(`[${MARK}]`).forEach(a => a.removeAttribute(MARK));
  const removePanel = () => { panel?.remove(); panel = undefined; label = undefined; };
  const makePanel = () => {
    panel = document.createElement('aside');
    panel.setAttribute(UI, '');
    panel.setAttribute('aria-label', 'SEO Lens: поиск домена');
    const shadow = panel.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial;position:fixed;bottom:18px;left:18px;z-index:2147483647}section{display:flex;align-items:center;gap:14px;max-width:min(520px,80vw);padding:12px 15px;border-radius:12px;background:#151916;color:#ccff5f;box-shadow:0 6px 30px #0004;font:13px/1.5 "Segoe UI",sans-serif}span{overflow-wrap:anywhere}button{flex:none;background:transparent;border:1px solid #6f8158;border-radius:6px;color:#ccff5f;padding:0 7px;font:20px/1.3 sans-serif;cursor:pointer}button:focus-visible{outline:2px solid #fff;outline-offset:3px}';
    const section = document.createElement('section');
    label = document.createElement('span');
    label.setAttribute('role', 'status');
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Убрать подсветку на этой странице');
    close.addEventListener('click', () => { dismissed = true; clearMarks(); removePanel(); });
    section.append(label, close);
    shadow.append(style, section);
    document.documentElement.append(panel);
  };
  const style = document.createElement('style');
  style.setAttribute(UI, '');
  style.textContent = `a[${MARK}]{outline:2px solid #557e00!important;outline-offset:3px!important;background:#e9ffb5!important;color:#203000!important;border-radius:3px!important;box-decoration-break:clone!important;-webkit-box-decoration-break:clone!important}`;
  document.documentElement.append(style);
  const scan = () => {
    if (!targetDomain || dismissed) { clearMarks(); removePanel(); return; }
    let count = 0;
    for (const anchor of document.querySelectorAll('a[href]')) {
      const url = destination(anchor);
      const host = url?.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
      const match = host === targetDomain || host?.endsWith(`.${targetDomain}`);
      if (match) { anchor.setAttribute(MARK, ''); count++; }
      else if (anchor.hasAttribute(MARK)) anchor.removeAttribute(MARK);
    }
    if (!panel?.isConnected) makePanel();
    const text = `SEO LENS · ${targetDomain} · ссылок на странице: ${count}`;
    if (label.textContent !== text) label.textContent = text;
  };
  const schedule = () => { clearTimeout(scheduled); scheduled = setTimeout(scan, 220); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] });
  chrome.storage.local.get(['searchTargetDomain']).then(settings => {
    targetDomain = normalizeDomain(settings.searchTargetDomain);
    scan();
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.searchTargetDomain) return;
    targetDomain = normalizeDomain(changes.searchTargetDomain.newValue);
    dismissed = false;
    scan();
  });
})();
