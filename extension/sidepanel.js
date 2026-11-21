const frame = document.getElementById('app');
const APP_URL = self.BYP_APP_URL || 'http://127.0.0.1:5173/panel.html';
const APP_ORIGIN = new URL(APP_URL).origin;
frame.src = APP_URL;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function snapshot() {
  const tab = await activeTab();
  if (!tab?.id) return;
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  frame.contentWindow.postMessage({ type: 'byp:snapshot', snapshot: result }, APP_ORIGIN);
}

window.addEventListener('message', async (ev) => {
  if (ev.origin !== APP_ORIGIN) return;
  const tab = await activeTab();
  const msg = ev.data || {};
  if (msg.type === 'byp:ready' || msg.type === 'byp:requestSnapshot') await snapshot();
  if (msg.type === 'byp:highlight' && tab?.id) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: highlight, args: [msg.quote] });
  }
  if (msg.type === 'byp:fetchTerms' && tab?.id) {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: fetchText, args: [msg.href] });
    frame.contentWindow.postMessage({ type: 'byp:terms', href: msg.href, text: result }, APP_ORIGIN);
  }
  if (msg.type === 'byp:reminder' && msg.remindOn) {
    chrome.runtime.sendMessage({ type: 'byp:alarm', remindOn: msg.remindOn, site: msg.site });
  }
});

// Runs in the page. Scrolls to the sentence and marks it.
function highlight(quote) {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const q = norm(quote).slice(0, 60);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let best = null;
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (norm(el.innerText || '').includes(q)) best = el; // deepest match wins
  }
  if (!best) return false;
  document.querySelectorAll('.byp-mark').forEach((e) => { e.classList.remove('byp-mark'); e.style.outline = ''; e.style.background = ''; });
  best.classList.add('byp-mark');
  best.style.outline = '3px solid #e8a400';
  best.style.background = '#fff3c4';
  best.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}

// Runs in the page, so a same-site terms page is fetched with the page's own origin.
async function fetchText(href) {
  try {
    const html = await (await fetch(href, { credentials: 'omit' })).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,noscript').forEach((e) => e.remove());
    return (doc.body.textContent || '').replace(/\s+/g, ' ').slice(0, 60000);
  } catch (e) {
    return '';
  }
}

chrome.tabs.onActivated.addListener(() => snapshot());
