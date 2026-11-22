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

// An amount from the model only counts if the same amount is written on the
// page. Returns the amount as the page prints it (models often drop the "$").
export function amountOnPage(amount: string, page: PageSnapshot): string | undefined {
  const v = amountValue(amount);
  if (!Number.isFinite(v)) return undefined;
  const all = [page.text, ...page.checkboxes.map((c) => c.label)].join('\n');
  return amountsIn(all).find((a) => Math.abs(amountValue(a) - v) < 0.005);
}

export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
    const printed = r.amount ? amountOnPage(r.amount, page) : undefined;
    if (!quoteAppears(r.quote, page)) {
      f.verification = 'unverified';
      f.reason = 'The quoted words are not on this page.';
    } else if (r.amount && !printed) {
      f.verification = 'unverified';
      f.reason = `${r.amount} does not appear on this page.`;
    }
    if (printed) f.amount = printed;
    // A reminder date is only worked out from a verified quote that itself
    // contains the trial length, so a made-up number can never set a reminder.
    if (f.verification === 'verified' && r.kind === 'trial_conversion' && r.trialLength && r.trialUnit
      && new RegExp(`\\b${r.trialLength}[-\\s]?(day|week|month)`, 'i').test(r.quote)) {
      const d = addTrial(start, r.trialLength, r.trialUnit);
      if (d) f.convertsOn = localDate(d);
    }
    return f;
  });
}
