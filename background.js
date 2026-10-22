'use strict';
importScripts('lists-store.js');
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'seoLists') return false;
  SeoListsStore.dispatch(message).then(
    state => sendResponse({ ok: true, state }),
    error => sendResponse({ ok: false, error: error.message || String(error) })
  );
  return true;
});
