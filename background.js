'use strict';
importScripts('lists-store.js', 'deepseek.js', 'openpagerank.js');
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'seoLists') return false;
  SeoListsStore.dispatch(message).then(
    state => sendResponse({ ok: true, state }),
    error => sendResponse({ ok: false, error: error.message || String(error) })
  );
  return true;
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'seoDeepSeek') return false;
  SeoDeepSeek.dispatch(message, sender).then(
    result => sendResponse({ ok: true, result }),
    error => sendResponse({ ok: false, error: error.message || 'DeepSeek request failed' })
  );
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'seoOpenPageRank') return false;
  SeoOpenPageRank.dispatch(message, sender).then(
    result => sendResponse({ok:true,result}),
    error => sendResponse({ok:false,error:error.message || 'OPR недоступен.'})
  );
  return true;
});
