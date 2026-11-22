import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
import { ruleFindings } from './rules';
import { verifyFindings, quoteAppears, addTrial } from './verify';
import { redact } from './redact';
import { mergeFindings } from './merge';
import { clip } from './ai';
import { summaryLine } from './summary';
import { snapshotDocument } from './snapshot';
import type { PageSnapshot } from './types';

function demoSnapshot(): PageSnapshot {
  const dom = new JSDOM(readFileSync(resolve(__dirname, '../demo-store/index.html'), 'utf8'));
  // jsdom has no layout, so innerText is missing; fall back to textContent.
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  const s = snapshotDocument(dom.window.document, 'https://demo.example/checkout');
  return { ...s, capturedAt: '2026-11-22T15:00:00.000Z' };
}

describe('basic check on the demo store', () => {
  const page = demoSnapshot();
  const found = verifyFindings(ruleFindings(page), page, 'rules');

  it('finds the trial and computes the date in code', () => {
    const t = found.find((f) => f.kind === 'trial_conversion');
    expect(t?.amount).toBe('$14.99');
    expect(t?.convertsOn).toBe('2026-12-06');
    expect(t?.verification).toBe('verified');
  });
  it('finds both pre-ticked add-ons and ignores the unticked box', () => {
    const addons = found.filter((f) => f.kind === 'prechecked_addon').map((f) => f.amount);
    expect(addons).toEqual(['$4.99', '$2.99']);
  });
  it('finds auto renewal and the cancel link', () => {
    expect(found.some((f) => f.kind === 'auto_renew')).toBe(true);
    expect(found.some((f) => f.kind === 'cancel_path')).toBe(true);
  });
});

describe('verification', () => {
  const page = demoSnapshot();
  it('rejects a paraphrased quote', () => {
    expect(quoteAppears('The trial lasts two weeks', page)).toBe(false);
    const [f] = verifyFindings([{ kind: 'recurring_charge', quote: 'The plan costs $9.99 a month', amount: '$9.99' }], page, 'on_device');
    expect(f.verification).toBe('unverified');
  });
  it('rejects an amount that is not on the page even with a real quote', () => {
    const [f] = verifyFindings([{ kind: 'recurring_charge', quote: 'Tunebox Plus is $14.99/month', amount: '$19.99' }], page, 'on_device');
    expect(f.verification).toBe('unverified');
  });
  it('does date math across month ends', () => {
    expect(addTrial(new Date('2026-01-31T12:00:00Z'), 7, 'day')?.toISOString().slice(0, 10)).toBe('2026-02-07');
    expect(addTrial(new Date('2026-11-22T12:00:00Z'), 999, 'day')).toBeUndefined();
  });
});

describe('redaction for the consented cloud fallback', () => {
  it('removes email, card ending and street address', () => {
    const out = redact('Jordan, jordan.avery@example.com, Visa ending 4242, 12 Elm Street');
    expect(out).not.toMatch(/example\.com|4242|Elm Street/);
  });
});

describe('fees and duplicates', () => {
  const page = demoSnapshot();
  const found = verifyFindings(ruleFindings(page), page, 'rules');
  it('finds the one-time activation fee', () => {
    expect(found.find((f) => f.kind === 'fee')?.amount).toBe('$1.99');
  });
  it('does not report a ticked add-on twice', () => {
    expect(found.filter((f) => f.quote.includes('Priority Support')).length).toBe(1);
  });
});

describe('review fixes', () => {
  it('a price like $14.99 does not count as a 14 day trial', () => {
    const page = { url: 'https://x.test/', title: 't', text: 'Start free. Then $14.99/month.', capturedAt: '2026-11-22T12:00:00Z', checkboxes: [], links: [] } as any;
    const [f] = verifyFindings([{ kind: 'trial_conversion', quote: 'Then $14.99/month.', amount: '14.99', trialLength: 14, trialUnit: 'day' } as any], page, 'in_cloud');
    expect(f.verification).toBe('verified');
    expect(f.amount).toBe('$14.99');
    expect(f.convertsOn).toBeUndefined();
  });
  it('redaction removes emails, cards and phones but keeps prices', () => {
    const out = redact('Mail jo@ex.com, card 4111 1111 1111 1111, call (555) 123-4567. Price $14.99/month.');
    expect(out).not.toMatch(/jo@ex\.com|4111|123-4567/);
    expect(out).toContain('$14.99');
  });
  it('a model cancel card is dropped when real links exist', () => {
    const a = { kind: 'cancel_path', quote: 'How to cancel', source: 'rules', verification: 'verified' } as any;
    const b = { kind: 'cancel_path', quote: 'See terms and How to cancel.', source: 'in_cloud', verification: 'verified' } as any;
    expect(mergeFindings([a], [b])).toHaveLength(1);
  });
});

describe('judge review fixes', () => {
  it('a long page keeps its fine print at the end', () => {
    const text = 'top '.repeat(3000) + 'Renews at $9.99/month.';
    const out = clip(text, 6000);
    expect(out.length).toBeLessThan(6100);
    expect(out).toContain('Renews at $9.99/month.');
  });
  it('the summary does not say free when money is due today', () => {
    const f = (o: object) => ({ verification: 'verified', source: 'in_cloud', quote: 'q', ...o }) as any;
    expect(summaryLine([f({ kind: 'due_today', amount: '$7.98' }), f({ kind: 'trial_conversion', amount: '$9.99', convertsOn: '2026-11-29' })])).toMatch(/^\$7\.98 today, then \$9\.99/);
  });
  it('a recurring card that repeats the trial price is folded into the trial card', () => {
    const t = { kind: 'trial_conversion', quote: 'a', amount: '$14.99', trialLength: 14, source: 'rules', verification: 'verified' } as any;
    const r = { kind: 'recurring_charge', quote: 'b', amount: '$14.99', source: 'rules', verification: 'verified' } as any;
    expect(mergeFindings([t, r]).map((x) => x.kind)).toEqual(['trial_conversion']);
  });
});

describe('free trial or intro price', () => {
  const pg = (text: string) => ({ url: 'https://x.test/', title: 't', text, capturedAt: '2026-11-22T12:00:00Z', checkboxes: [], links: [] }) as any;
  const t = (quote: string) => ({ kind: 'trial_conversion', quote, amount: '$17', trialLength: 1, trialUnit: 'month' }) as any;
  it('a $1 first month is an intro price, not a free trial', () => {
    const page = pg('Pay $1 today for your first month. After your first month, $17 per month.');
    const [f] = verifyFindings([t('After your first month, $17 per month.')], page, 'in_cloud');
    expect(f.kind).toBe('recurring_charge');
    expect(f.convertsOn).toBeUndefined();
  });
  it('a percent-off first week is an intro price', () => {
    const page = pg('50% off your first week: $8.50. Then $17/week.');
    expect(verifyFindings([t('Then $17/week.')], page, 'in_cloud')[0].kind).toBe('recurring_charge');
  });
  it('a real free trial stays a trial', () => {
    const page = pg('Start your 1-month free trial. Then $17 per month.');
    expect(verifyFindings([t('Then $17 per month.')], page, 'in_cloud')[0].kind).toBe('trial_conversion');
  });
  it('a $0 first month counts as free', () => {
    const page = pg('$0 for your first month, then $17 per month.');
    expect(verifyFindings([t('then $17 per month.')], page, 'in_cloud')[0].kind).toBe('trial_conversion');
  });
});

describe('renewal reading', () => {
  it('"No automatic renewal" is not shown as a renewal', () => {
    const page = { url: 'https://x.test/', title: 't', text: 'One payment of $89.99. No automatic renewal.', capturedAt: '2026-11-22T12:00:00Z', checkboxes: [], links: [] } as any;
    const [f] = verifyFindings([{ kind: 'auto_renew', quote: 'No automatic renewal.' } as any], page, 'in_cloud');
    expect(f.verification).toBe('unverified');
  });
  it('the demo store hides two charges the basic check cannot see', () => {
    const amounts = ruleFindings(demoSnapshot()).map((f) => f.amount);
    expect(amounts).not.toContain('$3.99');
    expect(amounts).not.toContain('$2.49');
  });
});
