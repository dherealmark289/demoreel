/**
 * DemoReel Recorder — background.js (Service Worker)
 * Handles messaging between popup and content scripts
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[DemoReel] Extension installed');
});

// Forward messages between popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DEMOREEL_OPEN_TAB') {
    chrome.tabs.create({ url: message.url });
    sendResponse({ ok: true });
  }

  if (message.type === 'DEMOREEL_GET_JOBS') {
    chrome.storage.local.get(['recentJobs'], (result) => {
      sendResponse({ jobs: result.recentJobs || [] });
    });
    return true; // async
  }

  if (message.type === 'DEMOREEL_INJECT_REGION') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: () => {
            window.postMessage({ type: 'DEMOREEL_REGION_SELECT' }, '*');
          },
        });
        sendResponse({ ok: true });
      }
    });
    return true; // async
  }
});

// Handle tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Could inject content script dynamically if needed
  }
});
