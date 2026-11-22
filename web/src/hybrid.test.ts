import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { ruleFindings } from './rules';
import { verifyFindings } from './verify';
import { mergeFindings } from './merge';
import { snapshotDocument } from './snapshot';
import { firstYear, periodFromText } from './cost';
import { cancelBy, icsFor, termsFacts } from './deadline';
import { markRedactions } from './receipt';
import type { PageSnapshot, RawFinding } from './types';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
function demo(): PageSnapshot {
  const dom = new JSDOM(read('../demo-store/index.html'));
  // jsdom has no layout, so innerText is missing; fall back to textContent.
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  // Chrome's innerText puts line breaks between blocks; textContent does not.
  // Add them so the text looks like what Chrome gives the app.
  for (const el of dom.window.document.querySelectorAll('div, p, label, li, h1, h2, h3, button, span')) el.after(dom.window.document.createTextNode('\n'));
  return { ...snapshotDocument(dom.window.document, 'https://before-you-pay-9b8c6.web.app/demo-store/index.html'), capturedAt: '2026-11-22T15:00:00.000Z' };
}
// The saved real cloud read of the demo store (web/public/demo-cache.json).
function cloudRead(): RawFinding[] {
  const c = JSON.parse(read('../public/demo-cache.json'));
  return (Object.values(c.entries) as { kind: string; value: RawFinding[] }[]).find((e) => e.kind === 'redacted')!.value;
}
const termsText = () => new JSDOM(read('../public/terms.html')).window.document.body.textContent!.replace(/\s+/g, ' ');

describe('first-year cost', () => {
  it('reads periods from the words', () => {
    expect(periodFromText('+$3.99 each month')).toBe('month');
    expect(periodFromText('We add $2.49 to every bill')).toBe('bill');
    expect(periodFromText('A one-time activation fee of $1.99')).toBe('once');
    expect(periodFromText('$4 every four weeks')).toBe('four_weeks');
  });
  it('adds up the demo store from the full read, and shows what the basic check missed', () => {
    const page = demo();
    const basic = mergeFindings(verifyFindings(ruleFindings(page), page, 'rules'));
    const full = mergeFindings(basic, verifyFindings(cloudRead(), page, 'in_cloud'));
    const b = firstYear(basic, page)!;
    const f = firstYear(full, page)!;
    // 14.99, 4.99, 2.99, 3.99 and 2.49 every month for 12 months, plus 1.99 once.
    expect(f.total).toBe(355.39);
    expect(f.firstBill).toBe(31.44);
    expect(f.plusTax).toBe(true);
    // Without the model: no Lossless add-on (price outside its label) and no $2.49 line.
    expect(b.total).toBe(277.63);
  });
  it('gives no single total for a page with several plans', () => {
    const page = { url: 'https://x.test/', title: 't', text: 'Basic $8.99/month. Premium $19.99/month.', capturedAt: '2026-11-22T12:00:00Z', checkboxes: [], links: [] } as PageSnapshot;
    expect(firstYear(verifyFindings(ruleFindings(page), page, 'rules'), page)).toBeUndefined();
  });
});

describe('cancel-by date', () => {
  it('finds the notice and refund lines on the demo terms page', () => {
    const facts = termsFacts(termsText(), []);
    expect(facts.notice?.hours).toBe(24);
    expect(facts.noRefund?.quote).toMatch(/non-refundable/);
    expect(facts.from).toBe('basic');
  });
  it('uses a quote from Gemini only if it is really on the terms page', () => {
    expect(termsFacts(termsText(), ['You must cancel at least 7 days before your renewal date.']).notice?.hours).toBe(24);
    expect(termsFacts(termsText(), ['You must cancel at least 24 hours before your renewal date to avoid being charged for the next period.']).from).toBe('gemini');
  });
  it('keeps the notice plus one day of margin', () => {
    expect(cancelBy('2026-12-06', { hours: 24 })).toBe('2026-12-04');
    expect(cancelBy('2026-12-06')).toBe('2026-12-05');
    expect(cancelBy('2026-12-06', { hours: 72 })).toBe('2026-12-02');
  });
  it('builds a calendar file with the date and the quotes, redacted', () => {
    const ics = icsFor({ site: 'shop.test', cancelBy: '2026-12-04', convertsOn: '2026-12-06', firstBill: '$31.44', quotes: ['Card ending 4242, mail a@b.com'], now: new Date('2026-11-22T12:00:00Z') });
    expect(ics).toContain('DTSTART;VALUE=DATE:20261204');
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics.replace(/\r\n /g, '')).toContain('[card ending]');
    expect(ics).not.toContain('a@b.com');
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
  });
});

describe('what left this device', () => {
  it('marks what redaction removed without showing it', () => {
    expect(markRedactions('Hi [email], card [card ending].').filter((p) => p.removed).map((p) => p.text)).toEqual(['[email]', '[card ending]']);
  });
});

describe('redaction keeps the sentence end', () => {
  it('does not swallow the period after an email', async () => {
    const { redact } = await import('./redact');
    expect(redact('Signed in as a.b@example.co.uk. Next')).toBe('Signed in as [email]. Next');
  });
});
