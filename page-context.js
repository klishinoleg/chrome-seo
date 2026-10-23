/* Runs in the isolated extension world; never exports existing control values. */
(() => {
  'use strict';
  if (globalThis.__seoAiContext) return;
  const ids = new WeakMap();
  let serial = 0, snapshotUrl = '', contextId = '', knownForms = new Map();
  const unsafe = /pass(?:word)?|secret|token|\bauth(?:entication|orization)?\b|login|sign[ -]?in|credit|card|cvv|cvc|iban|payment|otp|one.time|verification|social.security/i;
  const permitted = new Set(['text', 'email', 'url', 'tel', 'search', 'number', 'textarea', 'select-one']);
  const clean = (value, max = 300) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const id = node => { if (!ids.has(node)) ids.set(node, `seo-ai-${++serial}`); return ids.get(node); };
  function visible(node) {
    if (!node.isConnected || node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && node.getClientRects().length > 0;
  }
  function labelText(node) {
    const parts = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let visited = 0, length = 0;
    while (walker.nextNode() && visited++ < 500 && length < 300) {
      const parent = walker.currentNode.parentElement;
      if (!parent || !visible(parent) || parent.closest('input,textarea,select,option,button,script,style,noscript,template,[contenteditable]')) continue;
      const text = clean(walker.currentNode.textContent, 300 - length);
      if (text) { parts.push(text); length += text.length + 1; }
    }
    return parts.join(' ');
  }
  function label(node) {
    return clean(Array.from(node.labels || []).map(labelText).join(' ') || node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.name || node.tagName);
  }
  const purpose = node => [node.id, node.name, node.getAttribute('autocomplete'), node.getAttribute('aria-label'), node.getAttribute('placeholder'), label(node)].join(' ');
  function unsafeForm(form) {
    if (!form) return false;
    const metadata = [form.id, form.name, form.getAttribute('action'), form.getAttribute('aria-label')].join(' ');
    const fields = Array.from(form.elements || []);
    return unsafe.test(metadata) || fields.some(field => field.type === 'password');
  }
  function allowed(field, form) {
    return field.form === form && visible(field) && !field.disabled && !field.matches(':disabled') && !field.readOnly && !field.isContentEditable && permitted.has(field.type) && !unsafe.test(purpose(field));
  }
  function snapshot() {
    const forms = [], registry = new Map();
    for (const form of [...document.forms, null]) {
      if (forms.length >= 12) break;
      const formNode = form || document.body;
      if (!formNode || !visible(formNode) || unsafeForm(form)) continue;
      const fields = [], fieldMap = new Map();
      for (const field of form ? form.elements : document.querySelectorAll('input,textarea,select')) {
        if (fields.length >= 40) break;
        if (!allowed(field, form)) continue;
        const fieldId = id(field);
        const options = field.tagName === 'SELECT' ? Array.from(field.options).filter(option => !option.disabled && !option.hidden && !option.parentElement.disabled && !option.parentElement.hidden && option.value.length <= 1000 && !unsafe.test(option.value)).slice(0, 100).map(option => ({ value: option.value, label: clean(option.label) })) : [];
        fields.push({ id: fieldId, name: clean(field.name), label: label(field), type: field.type, required: Boolean(field.required), options });
        fieldMap.set(fieldId, { node: field, type: field.type, purpose: purpose(field) });
      }
      if (!fields.length) continue;
      const formId = id(formNode);
      forms.push({ id: formId, label: clean(formNode.getAttribute('aria-label') || formNode.getAttribute('name') || formNode.id || `Form ${forms.length + 1}`), fields });
      registry.set(formId, { node: formNode, owner: form, fields: fieldMap, action: form && form.action });
    }
    const chunks = [];
    let length = 0;
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && length < 24000) {
      const node = walker.currentNode, parent = node.parentElement;
      if (!parent || parent.closest('script,style,noscript,template,nav,header,footer,input,textarea,select,option,button,[contenteditable],[role="navigation"],[role="banner"],[role="contentinfo"]') || !visible(parent)) continue;
      const form = parent.closest('form');
      if (form && unsafeForm(form)) continue;
      const text = clean(node.textContent, 24000 - length);
      if (text) { chunks.push(text); length += text.length + 1; }
    }
    snapshotUrl = location.href;
    contextId = crypto.randomUUID();
    knownForms = registry;
    return { contextId, url: snapshotUrl, title: clean(document.title, 1000), text: chunks.join('\n').slice(0, 24000), forms };
  }
  function fill(request) {
    const filled = [], skipped = [];
    if (!request || !Array.isArray(request.fields) || request.fields.length > 40) throw new Error('Invalid fill request');
    const record = knownForms.get(request.formId);
    if (!contextId || request.contextId !== contextId || request.url !== snapshotUrl || location.href !== snapshotUrl || !record || !record.node.isConnected || !visible(record.node) || (record.owner && record.owner.action) !== record.action || unsafeForm(record.owner)) throw new Error('Page or form changed. Capture the page again.');
    const seen = new Set();
    for (const item of request.fields) {
      const entry = item && record.fields.get(item.id), field = entry && entry.node;
      if (location.href !== snapshotUrl || request.contextId !== contextId || !record.node.isConnected || (record.owner && record.owner.action) !== record.action || !entry || seen.has(item.id) || typeof item.value !== 'string' || item.value.length > 10000 || !allowed(field, record.owner) || field.type !== entry.type || purpose(field) !== entry.purpose) { skipped.push(item && item.id || 'unknown'); continue; }
      seen.add(item.id);
      if (field.tagName === 'SELECT' && !Array.from(field.options).some(option => option.value === item.value && !option.disabled && !option.parentElement.disabled)) { skipped.push(item.id); continue; }
      const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, item.value);
      // Deliberately do not dispatch events: page handlers may submit or navigate.
      filled.push(item.id);
    }
    return { filled: filled.length, skipped: skipped.length, filledIds: filled, skippedIds: skipped };
  }
  globalThis.__seoAiContext = Object.freeze({ snapshot, fill });
})();
