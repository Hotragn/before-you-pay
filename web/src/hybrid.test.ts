import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { ruleFindings } from './rules';
import { fillFromPage, verifyFindings } from './verify';
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
  it('counts only the bills inside the first 12 months', () => {
    const page = { url: 'https://x.test/', title: 't', text: 'Your 3-month free trial starts today. After your trial, it is $10.00/month.', capturedAt: '2026-11-22T15:00:00.000Z', checkboxes: [], links: [] } as PageSnapshot;
    const fy = firstYear(verifyFindings(ruleFindings(page), page, 'rules'), page)!;
    expect(fy.lines[0].count).toBe(9);
    expect(fy.total).toBe(90);
  });
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
  it('adds up a Nano read that left amounts out, the way the first real run did', () => {
    // The shapes Gemini Nano gave on Kaggle on Nov 24 (from the panel cards):
    // no amount on the due-today and per-bill lines, ticked add-ons called
    // recurring charges, and the Lossless add-on quoted by its label only.
    const nano: RawFinding[] = [
      { kind: 'due_today', quote: '$0.00 due today' },
      { kind: 'trial_conversion', quote: 'After your trial, Tunebox Plus is $14.99/month plus any add-ons you selected.', amount: '$14.99' },
      { kind: 'recurring_charge', quote: 'Add Priority Support for $4.99/month', amount: '$4.99' },
      { kind: 'recurring_charge', quote: 'Add Family Sharing for $2.99/month', amount: '$2.99' },
      { kind: 'recurring_charge', quote: 'Lossless Hi-Fi upgrade' },
      { kind: 'fee', quote: 'We add $2.49 to every bill for music licensing.' },
      { kind: 'auto_renew', quote: 'Your subscription renews automatically each month until you cancel.' },
    ];
    const page = demo();
    const basic = mergeFindings(verifyFindings(ruleFindings(page), page, 'rules'));
    const full = mergeFindings(basic, verifyFindings(nano, page, 'on_device'));
    expect(full.find((f) => f.kind === 'due_today')?.amount).toBe('$0.00');
    expect(full.filter((f) => f.kind === 'recurring_charge')).toHaveLength(0);
    expect(full.find((f) => f.quote === 'Lossless Hi-Fi upgrade')).toMatchObject({ kind: 'prechecked_addon', amount: '$3.99', verification: 'verified' });
    const fy = firstYear(full, page)!;
    expect(fy.total).toBe(355.39);
    expect(fy.firstBill).toBe(31.44);
  });
  it('fills amounts only from the page, never by guessing', () => {
    const page = demo();
    // Two different amounts in the quote: no way to tell which one, so none.
    expect(fillFromPage({ kind: 'fee', quote: 'Add Priority Support for $4.99/month and $2.99' }, page).amount).toBeUndefined();
    // A label that is not ticked keeps its kind and gets no price from nearby text.
    expect(fillFromPage({ kind: 'recurring_charge', quote: 'Email me news and offers' }, page)).toEqual({ kind: 'recurring_charge', quote: 'Email me news and offers' });
    // An amount the model did give is left alone; verification still checks it.
    expect(fillFromPage({ kind: 'fee', quote: 'We add $2.49 to every bill for music licensing.', amount: '$9.99' }, page).amount).toBe('$9.99');
    // A paraphrase that is not on the page still fails verification after filling.
    const [f] = verifyFindings([{ kind: 'fee', quote: 'They add $2.49 per bill.' }], page, 'on_device');
    expect(f.verification).toBe('unverified');
  });
  it('gives no single total for a page with several plans', () => {
    const page = { url: 'https://x.test/', title: 't', text: 'Basic $8.99/month. Premium $19.99/month.', capturedAt: '2026-11-22T12:00:00Z', checkboxes: [], links: [] } as PageSnapshot;
    expect(firstYear(verifyFindings(ruleFindings(page), page, 'rules'), page)).toBeUndefined();
  });
});

describe('cancel-by date', () => {
  it('reads other ways of writing the notice, and not reminders', () => {
    const t = (x: string) => termsFacts(x + ' Filler sentence to make it long enough.', []).notice?.hours;
    expect(t('Cancel no later than 48 hours before renewal.')).toBe(48);
    expect(t('We need 30 days\' written notice to cancel.')).toBe(720);
    expect(t('Give three (3) business days notice.')).toBe(120);
    expect(t('We will remind you 7 days before your trial ends.')).toBeUndefined();
  });
  it('finds the notice and refund lines on the demo terms page', () => {
    const facts = termsFacts(termsText(), []);
    expect(facts.notice?.hours).toBe(24);
    expect(facts.noRefund?.quote).toMatch(/non-refundable/);
    expect(facts.notice?.from).toBe('basic');
  });
  it('uses a quote from Gemini only if it is really on the terms page', () => {
    expect(termsFacts(termsText(), ['You must cancel at least 7 days before your renewal date.']).notice?.hours).toBe(24);
    const g = termsFacts(termsText(), ['You must cancel at least 24 hours before your renewal date to avoid being charged for the next period.']);
    expect(g.notice?.from).toBe('gemini');
    // The refund line was not quoted by Gemini, so it keeps its own label.
    expect(g.noRefund?.from).toBe('basic');
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
