// Draws docs/architecture.svg and .png in a hand-drawn style.
// Needs: npm i roughjs @fontsource/kalam puppeteer-core (run from a scratch folder).
// Paths below assume it runs next to those node_modules.
import rough from 'roughjs';
import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const gen = rough.generator();
const W = 1400, H = 860;
const font = (w) => readFileSync(`node_modules/@fontsource/kalam/files/kalam-latin-${w}-normal.woff2`).toString('base64');
let seed = 7;
const out = [];
const draw = (d) => { for (const p of gen.toPaths(d)) out.push(`<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill || 'none'}"/>`); };
const o = (x = {}) => ({ seed: seed++, roughness: 1.3, bowing: 1.2, strokeWidth: 2, stroke: '#1e1e1e', ...x });
const text = (x, y, s, { size = 24, w = 400, color = '#1e1e1e', anchor = 'middle' } = {}) =>
  s.split('\n').forEach((line, i) => out.push(`<text x="${x}" y="${y + i * size * 1.2}" font-family="Kalam" font-weight="${w}" font-size="${size}" fill="${color}" text-anchor="${anchor}">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`));
const box = (x, y, w, h, fill, extra = {}) => draw(gen.rectangle(x, y, w, h, o({ fill, fillStyle: 'hachure', hachureGap: 7, fillWeight: 1.2, ...extra })));
const arrow = (pts, color = '#1e1e1e', dash) => {
  draw(gen.curve(pts, o({ stroke: color, strokeWidth: 2.4, ...(dash ? { strokeLineDash: [10, 8] } : {}) })));
  const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  for (const s of [-1, 1]) draw(gen.line(b[0], b[1], b[0] - 18 * Math.cos(ang + s * 0.45), b[1] - 18 * Math.sin(ang + s * 0.45), o({ stroke: color, strokeWidth: 2.4 })));
};
const GREEN = '#2f9e44', BLUE = '#1971c2', RED = '#e03131', AMBER = '#f08c00';

text(W / 2, 48, 'Before You Pay: where your text goes', { size: 36, w: 700 });

// Laptop zone
draw(gen.rectangle(30, 80, 760, 740, o({ strokeLineDash: [14, 10], roughness: 1.8, stroke: '#495057' })));
text(60, 118, 'your laptop (Chrome)', { size: 26, w: 700, anchor: 'start', color: '#495057' });

box(70, 150, 300, 120, '#ffe8cc');
text(220, 195, 'Checkout page', { size: 28, w: 700 });
text(220, 230, 'your name, email, card', { size: 22 });

box(450, 150, 300, 120, '#e7f5ff');
text(600, 195, 'Before You Pay', { size: 28, w: 700 });
text(600, 230, 'side panel', { size: 22 });
arrow([[372, 210], [410, 205], [446, 210]]);
text(410, 190, 'reads', { size: 20 });

box(70, 360, 360, 150, '#d3f9d8');
text(250, 410, 'Gemini Nano', { size: 32, w: 700, color: GREEN });
text(250, 445, 'Chrome Prompt API', { size: 22 });
text(250, 480, 'mode: ONLY_ON_DEVICE', { size: 22, w: 700 });
arrow([[540, 275], [470, 330], [380, 356]], GREEN);
text(560, 330, 'the checkout page\nstays here', { size: 22, color: GREEN, anchor: 'start' });

box(470, 400, 290, 110, '#fff9db');
text(615, 440, 'Code checks every', { size: 22 });
text(615, 468, 'quote and price,', { size: 22 });
text(615, 496, 'works out the dates', { size: 22 });
arrow([[432, 455], [450, 452], [466, 455]]);

box(70, 590, 300, 90, '#f1f3f5');
text(220, 630, 'Reminder + saved', { size: 22, w: 700 });
text(220, 660, 'record of the offer', { size: 22 });
arrow([[615, 515], [520, 580], [375, 630]]);

// Wi-Fi off note
draw(gen.ellipse(560, 752, 320, 100, o({ stroke: GREEN, roughness: 2 })));
text(560, 746, 'works with Wi-Fi off', { size: 26, w: 700, color: GREEN });
text(560, 776, 'nothing leaves the laptop', { size: 20, color: GREEN });

// Cloud zone
draw(gen.rectangle(880, 80, 490, 740, o({ strokeLineDash: [14, 10], roughness: 1.8, stroke: '#495057' })));
text(910, 118, 'Google cloud (Firebase)', { size: 26, w: 700, anchor: 'start', color: '#495057' });

box(920, 150, 410, 140, '#dbe4ff');
text(1125, 200, 'Gemini in the cloud', { size: 32, w: 700, color: BLUE });
text(1125, 235, 'Firebase AI Logic', { size: 22 });
text(1125, 268, 'mode: ONLY_IN_CLOUD', { size: 22, w: 700 });

box(920, 380, 410, 90, '#f8f9fa');
text(1125, 418, 'Public terms page', { size: 26, w: 700 });
text(1125, 450, 'nothing about you on it', { size: 20 });
arrow([[1125, 376], [1135, 340], [1125, 296]], BLUE);
text(1145, 330, 'how to cancel,\nnotice, refunds', { size: 20, color: BLUE, anchor: 'start' });

// Consent path
draw(gen.polygon([[640, 560], [730, 520], [820, 560], [730, 600]], o({ fill: '#fff3bf', fillStyle: 'solid', stroke: AMBER })));
text(730, 567, 'you say yes?', { size: 20, w: 700, color: AMBER });
arrow([[740, 275], [760, 390], [735, 515]], AMBER, true);
text(770, 380, 'no Nano\non this\ncomputer', { size: 18, color: AMBER, anchor: 'start' });
arrow([[822, 555], [880, 420], [930, 300]], AMBER, true);
text(730, 632, 'redacted copy', { size: 20, color: AMBER, w: 700 });
text(730, 656, 'no email, card, phone', { size: 18, color: AMBER });
text(730, 678, 'or street address', { size: 18, color: AMBER });

// Firebase services
box(920, 560, 195, 90, '#ffffff');
text(1017, 600, 'App Check', { size: 24, w: 700 });
text(1017, 630, 'reCAPTCHA Ent.', { size: 18 });
box(1135, 560, 195, 90, '#ffffff');
text(1232, 600, 'Firestore', { size: 24, w: 700 });
text(1232, 630, 'saved offers', { size: 18 });
box(920, 680, 195, 90, '#ffffff');
text(1017, 720, 'Remote Config', { size: 24, w: 700 });
text(1017, 750, 'kill switch, limits', { size: 18 });
box(1135, 680, 195, 90, '#ffffff');
text(1232, 720, 'Anonymous Auth', { size: 22, w: 700 });
text(1232, 750, 'owner-only rules', { size: 18 });

// The red no-go line
draw(gen.curve([[220, 146], [400, 92], [700, 90], [905, 96]], o({ stroke: RED, strokeLineDash: [6, 10], strokeWidth: 2 })));
draw(gen.line(820, 78, 856, 110, o({ stroke: RED, strokeWidth: 4 })));
draw(gen.line(856, 78, 820, 110, o({ stroke: RED, strokeWidth: 4 })));
text(560, 80, 'the checkout page never goes this way', { size: 20, color: RED, w: 700 });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>@font-face{font-family:Kalam;font-weight:400;src:url(data:font/woff2;base64,${font(400)}) format("woff2")}@font-face{font-family:Kalam;font-weight:700;src:url(data:font/woff2;base64,${font(700)}) format("woff2")}</style>
<rect width="100%" height="100%" fill="#fffdf8"/>${out.join('\n')}</svg>`;
writeFileSync('/workspace/hybridai/before-you-pay/docs/architecture.svg', svg);
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: W, height: H });
await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await p.evaluateHandle('document.fonts.ready');
await new Promise((r) => setTimeout(r, 500));
await p.screenshot({ path: '/workspace/hybridai/before-you-pay/docs/architecture.png' });
await b.close();
