import type { Finding, PageSnapshot, RawFinding } from './types';

// Normalize text so a quote still matches after whitespace, quote-mark and case
// differences. We do not allow anything looser than that: if the model
// paraphrased, the finding is marked unverified.
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u00a0\s]+/g, ' ')
    .trim();
}

export function quoteAppears(quote: string, page: PageSnapshot): boolean {
  const q = normalize(quote);
  if (q.length < 4) return false;
  const haystack = normalize(
    [page.text, ...page.checkboxes.map((c) => c.label), ...page.links.map((l) => l.text)].join('\n'),
  );
  return haystack.includes(q);
}

const MONEY = /(?:[$€£₹]\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|INR))/gi;

export function amountsIn(text: string): string[] {
  return (text.match(MONEY) ?? []).map((m) => m.replace(/\s/g, ''));
}

function amountValue(a: string): number {
  return Number(a.replace(/[^\d.]/g, ''));
}

// An amount from the model only counts if the same amount is written on the page.
export function amountOnPage(amount: string, page: PageSnapshot): boolean {
  const v = amountValue(amount);
  if (!Number.isFinite(v)) return false;
  return amountsIn(page.text).some((a) => Math.abs(amountValue(a) - v) < 0.005);
}

export function addTrial(start: Date, length: number, unit: string): Date | undefined {
  if (!Number.isFinite(length) || length <= 0 || length > 400) return undefined;
  const d = new Date(start.getTime());
  if (unit === 'day') d.setDate(d.getDate() + length);
  else if (unit === 'week') d.setDate(d.getDate() + 7 * length);
  else if (unit === 'month') d.setMonth(d.getMonth() + length);
  else return undefined;
  return d;
}

export function verifyFindings(
  raw: RawFinding[],
  page: PageSnapshot,
  source: Finding['source'],
): Finding[] {
  const start = new Date(page.capturedAt);
  return raw.map((r) => {
    const f: Finding = { ...r, source, verification: 'verified' };
    if (!quoteAppears(r.quote, page)) {
      f.verification = 'unverified';
      f.reason = 'The quoted words are not on this page.';
    } else if (r.amount && !amountOnPage(r.amount, page)) {
      f.verification = 'unverified';
      f.reason = `${r.amount} does not appear on this page.`;
    }
    if (r.kind === 'trial_conversion' && r.trialLength && r.trialUnit) {
      const d = addTrial(start, r.trialLength, r.trialUnit);
      if (d) f.convertsOn = d.toISOString().slice(0, 10);
    }
    return f;
  });
}
