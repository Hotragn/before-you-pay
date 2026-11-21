// End-to-end check of the deployed site in a real (non-headless) Chrome.
// Usage: DISPLAY=:99 node scripts/verify-deployed.mjs [url]
// Needs puppeteer-core (npm i -g puppeteer-core or run from a folder that has it).
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] || 'https://before-you-pay-9b8c6.web.app';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: false,
  userDataDir: process.env.PROFILE || '/tmp/byp-verify-profile', args: ['--no-first-run', '--window-size=1200,900'] });
const p = await b.newPage();
await p.setViewport({ width: 460, height: 1100 });
const net = [];
p.on('request', (r) => { if (/firebasevertexai|firestore|firebaseappcheck|remoteconfig|identitytoolkit|recaptcha/.test(r.url())) net.push(r.method() + ' ' + new URL(r.url()).host + new URL(r.url()).pathname.slice(0, 70)); });
p.on('console', (m) => console.log('  console:', m.text().slice(0, 220)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (sel) => p.$eval(sel, (e) => e.innerText).catch(() => '');

await p.goto(BASE + '/panel.html', { waitUntil: 'networkidle2' });
await p.click('#demo'); await wait(2500);
console.log('1. basic check cards:', (await p.$$('.card')).length);

await p.click('#check'); await wait(5000);
console.log('2. on-device attempt -> status:', JSON.stringify(await text('#status')), '| consent shown:', await p.$eval('#consent', (e) => !e.hidden));

await p.click('#readTerms');
for (let i = 0; i < 30 && /Fetching|reading/i.test(await text('#cancelOut')); i++) await wait(1000);
console.log('3. cloud terms read ->', JSON.stringify((await text('#cancelOut')).slice(0, 500)));

await p.click('#sendRedacted');
for (let i = 0; i < 30 && /Reading a redacted/.test(await text('#status')); i++) await wait(1000);
console.log('4. redacted cloud read -> status:', JSON.stringify(await text('#status')));
console.log('   cards now:', await p.$$eval('.card', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 90))));

await p.click('#remind'); await wait(4000);
console.log('5. save ->', JSON.stringify(await text('#saved')));
await p.reload({ waitUntil: 'networkidle2' }); await wait(4000);
console.log('6. after reload, saved offers listed:', await p.$$eval('#savedList li', (els) => els.length));
await p.screenshot({ path: '/workspace/hybridai/before-you-pay/docs/verify-deployed.png', fullPage: true });
console.log('network (Firebase services):', [...new Set(net)].join('\n  '));
await b.close();
