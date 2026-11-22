const frame = document.getElementById('app');
const APP_URL = self.BYP_APP_URL;
const APP_ORIGIN = new URL(APP_URL).origin;
frame.src = APP_URL;

// The tab and links of the latest snapshot. Highlights and terms fetches only
// ever go to that tab, and only for links that were on that page.
let current = { tabId: null, links: [] };

function toFrame(msg) {
  frame.contentWindow.postMessage(msg, APP_ORIGIN);
}

async function snapshot() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    current = { tabId: tab.id, links: (result.links || []).map((l) => l.href) };
    toFrame({ type: 'byp:snapshot', snapshot: result });
  } catch (e) {
    // activeTab is granted per click and lost on navigation.
    toFrame({ type: 'byp:error', message: 'Chrome needs your OK to read this page. Click the Before You Pay icon in the toolbar, then press Check again.' });
  }
}

window.addEventListener('message', async (ev) => {
  if (ev.origin !== APP_ORIGIN || ev.source !== frame.contentWindow) return;
  const msg = ev.data || {};
  try {
    if (msg.type === 'byp:requestSnapshot') await snapshot();
    if (msg.type === 'byp:highlight' && current.tabId) {
      await chrome.scripting.executeScript({ target: { tabId: current.tabId }, func: highlight, args: [String(msg.quote).slice(0, 400)] });
    }
    if (msg.type === 'byp:fetchTerms') {
      const ok = current.tabId && current.links.includes(msg.href) && /^https?:/.test(msg.href);
      let text = '';
      if (ok) {
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: current.tabId }, func: fetchText, args: [msg.href] });
        text = result || '';
      }
      toFrame({ type: 'byp:terms', href: msg.href, text });
    }
    if (msg.type === 'byp:reminder' && /^\d{4}-\d{2}-\d{2}$/.test(msg.remindOn || '')) {
      chrome.runtime.sendMessage({ type: 'byp:alarm', remindOn: msg.remindOn, site: String(msg.site).slice(0, 253) });
    }
  } catch (e) {
    toFrame({ type: 'byp:error', message: 'Lost access to the page. Click the toolbar icon and try again.' });
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

// Runs in the page, so a same-site terms page is fetched from the page's own origin.
async function fetchText(href) {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000);
    const html = await (await fetch(href, { credentials: 'omit', signal: ctrl.signal })).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,noscript').forEach((e) => e.remove());
    return (doc.body.textContent || '').replace(/\s+/g, ' ').slice(0, 60000);
  } catch (e) {
    return '';
  }
}
