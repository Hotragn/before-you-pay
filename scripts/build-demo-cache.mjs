// Builds web/public/demo-cache.json from REAL cloud reads of our own demo store
// and its terms page, so judges trying the demo do not use up the free quota.
// It opens the live panel (and the extension, which reads the page the same
// way but through its own content script), presses the real buttons, and saves
// what Firebase AI Logic returned. The panel labels these answers as saved,
// with the date, and the next press always does a fresh read.
// Usage: DISPLAY=:99 node scripts/build-demo-cache.mjs [path-to-extension-test-copy]
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const APP = 'https://before-you-pay-9b8c6.web.app';
const extDir = process.argv[2];
const entries = {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function collect(frame) {
  for (const e of await frame.evaluate(() => window.bypCloudLog ?? [])) entries[e.key] = { kind: e.kind, value: e.value, source: e.source, at: e.at };
}
async function pressAll(frame) {
  try { await pressAllInner(frame); } catch (e) {
    console.log('step failed:', e.message, '| status:', await frame.$eval('#status', (x) => x.textContent), '| terms:', await frame.$eval('#cancelOut', (x) => x.textContent));
  }
}
async function pressAllInner(frame) {
  await frame.click('#check');
  await frame.waitForFunction(() => !document.getElementById('consent').hidden, { timeout: 30000 });
  await frame.click('#sendRedacted');
  await frame.waitForFunction(() => /redacted copy in the cloud|did not work|earlier answer|saved answer/.test(document.getElementById('status').textContent), { timeout: 90000 });
  await wait(7000);
  await frame.click('#readTerms');
  await frame.waitForFunction(() => document.querySelector('#cancelOut ol li') || /Could not/.test(document.getElementById('cancelOut').textContent), { timeout: 90000 });
}
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: false, enableExtensions: !!extDir, pipe: !!extDir, userDataDir: '/tmp/byp-cache-build', args: ['--no-first-run'] });
// 1. The hosted panel with its built-in demo store.
const p = await b.newPage();
await p.goto(APP + '/panel.html', { waitUntil: 'networkidle2' });
await p.click('#demo');
await wait(2500);
await pressAll(p);
await collect(p);
// 2. The extension side panel next to the demo store tab.
if (extDir) {
  const id = await b.installExtension(extDir);
  const store = await b.newPage();
  await store.goto(APP + '/demo-store/', { waitUntil: 'networkidle2' });
  const sp = await b.newPage();
  await sp.goto(`chrome-extension://${id}/sidepanel.html`, { waitUntil: 'load' });
  await sp.evaluate(async () => {
    const st = (await chrome.tabs.query({})).find((t) => (t.url || '').includes('/demo-store/'));
    const orig = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = async (q) => (q && q.active ? [st] : orig(q));
  });
  await wait(6000);
  const frame = sp.frames().find((f) => f.url().startsWith(APP + '/panel.html'));
  await wait(7000);
  await pressAll(frame);
  await collect(frame);
}
await b.close();
writeFileSync(new URL('../web/public/demo-cache.json', import.meta.url), JSON.stringify({
  about: 'Saved answers from real Firebase AI Logic cloud reads of the Before You Pay demo store and its terms page. Used only for those pages, labeled in the panel, and skipped on the next press.',
  entries,
}, null, 1));
console.log('saved', Object.keys(entries).length, 'entries:', Object.values(entries).map((e) => `${e.kind}/${e.source}`).join(', '));
