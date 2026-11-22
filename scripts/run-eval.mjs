// Runs /eval.html in a real Chrome and saves the result JSON.
// Usage: DISPLAY=:99 node scripts/run-eval.mjs <mode: rules|cloud|device> [baseUrl] [outFile]
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';
const [mode = 'cloud', BASE = 'https://before-you-pay-9b8c6.web.app', out = `../eval/results-${mode}.json`] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: false, userDataDir: process.env.PROFILE || '/tmp/byp-verify-profile', args: ['--no-first-run'] });
const p = await b.newPage();
await p.goto(BASE + '/eval.html', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 3000));
await p.click('#' + (mode === 'device' ? 'device' : mode));
await p.waitForFunction(() => /Done|No on-device/.test(document.getElementById('status').innerText), { timeout: 600000 });
const result = await p.evaluate(() => window.evalResult ?? document.getElementById('status').innerText);
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result.summary ?? result, null, 1), 'errors:', result.errors);
await b.close();
