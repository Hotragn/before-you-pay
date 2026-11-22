// Usage: DISPLAY=:99 node scripts/offline-check.mjs
// Wi-Fi off test with a stand-in for Gemini Nano. This box cannot run the real
// model (blocked by policy), so window.LanguageModel is replaced by a stub that
// answers like the model would. What this proves: once the panel is open, the
// app and the Firebase AI Logic SDK read the page with ONLY_ON_DEVICE and make
// no network request. It does not test the real model.
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: false, userDataDir: '/tmp/byp-offline', args: ['--no-first-run'] });
const p = await b.newPage();
await p.setViewport({ width: 400, height: 1100 });
// The stand-in replays a REAL Gemini answer for the demo store: the saved cloud
// read in web/public/demo-cache.json. So the cards are real model output for
// this page, just not produced by Nano on this machine.
const cache = JSON.parse(readFileSync(new URL('../web/public/demo-cache.json', import.meta.url)));
const realAnswer = { findings: Object.values(cache.entries).find((e) => e.kind === 'redacted').value };
await p.evaluateOnNewDocument((answer) => {
  window.__stubCalls = [];
  window.LanguageModel = {
    availability: async () => 'available',
    params: async () => ({ defaultTopK: 3, maxTopK: 8, defaultTemperature: 1, maxTemperature: 2 }),
    create: async (opts) => {
      window.__stubCalls.push({ create: Object.keys(opts || {}) });
      return {
        prompt: async (contents, o) => { window.__stubCalls.push({ prompt: true, schema: !!o?.responseConstraint }); await new Promise((r) => setTimeout(r, 1200)); return JSON.stringify(answer); },
        promptStreaming: () => { throw new Error('not used'); },
        destroy() {}, inputUsage: 0, inputQuota: 6000,
      };
    },
  };
}, realAnswer);
await p.goto('https://before-you-pay-9b8c6.web.app/panel.html', { waitUntil: 'networkidle2' });
await p.click('#demo');
await new Promise((r) => setTimeout(r, 3000));
const requests = [];
p.on('request', (r) => requests.push(r.url()));
await p.setOfflineMode(true);
await p.evaluate(() => window.dispatchEvent(new Event('offline')));
await new Promise((r) => setTimeout(r, 500));
await p.click('#check');
await p.waitForFunction(() => /Read on this computer|did not work/.test(document.getElementById('status').textContent), { timeout: 30000 });
console.log('navigator.onLine:', await p.evaluate(() => navigator.onLine));
console.log('status:', await p.$eval('#status', (e) => e.textContent));
console.log('stub calls:', JSON.stringify(await p.evaluate(() => window.__stubCalls)));
console.log('cards:', await p.$$eval('#cards li', (l) => l.map((x) => x.innerText.replace(/\s+/g, ' ').slice(0, 70))));
console.log('network requests during the offline read:', requests.length, requests.slice(0, 5));
await p.screenshot({ path: new URL('../docs/offline-stub.png', import.meta.url).pathname, fullPage: true });
// The privacy receipt for this stand-in read (on-device row, 0 requests to Gemini).
console.log('ledger:', await p.$eval('#ledger', (e) => e.innerText.slice(0, 400)));
await (await p.$('#receipt')).screenshot({ path: new URL('../docs/receipt-offline-stub.png', import.meta.url).pathname });
await p.click('#readTerms');
await new Promise((r) => setTimeout(r, 3000));
console.log('terms while offline:', await p.$eval('#cancelOut', (e) => e.textContent));
await b.close();
