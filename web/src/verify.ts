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

// A free trial means nothing is charged for a while. Models often call a cheap
// first period ("$1 for your first month", "50% off your first week") a trial.
// So a trial only stands if the quote or the text just before it says "free",
// "$0" or "no charge", or says "trial" without a paid intro price nearby.
const FREE = /\bfree\b|[$€£]\s?0(?:\.00)?(?![\d.,])|\bno charge\b|\bon us\b/i;
const PAID_INTRO = /\d+\s?%\s?off|[$€£]\s?(?:0\.\d*[1-9]|[1-9][\d,]*(?:\.\d{1,2})?)\s+(?:today|for (?:the|your) first|for \d+)|\bintro(?:ductory)?\s+(?:price|offer|rate)|first (?:week|month|year|\d+ (?:days|weeks|months)) for [$€£]\s?[1-9]|[$€£]\s?[1-9][\d.]*\s+trial/i;

export function trialContext(quote: string, page: PageSnapshot): string {
  const text = normalize(page.text);
  const q = normalize(quote);
  const at = text.indexOf(q);
  return at < 0 ? q : text.slice(Math.max(0, at - 250), at + q.length);
}

export function looksLikeFreeTrial(quote: string, page: PageSnapshot): boolean {
  const ctx = trialContext(quote, page);
  if (FREE.test(ctx)) return true;
  return /\btrial\b/i.test(ctx) && !PAID_INTRO.test(ctx);
}

// The opposite mistake for renewals: a model sometimes quotes "No automatic
// renewal." as proof that a plan renews. The quote is real, the reading is not.
const NO_RENEW = /\bno (?:automatic|auto)[- ]?renewal\b|\b(?:does|will) not (?:auto[- ]?)?renew\b|\bwon't renew\b|\bnot renew automatically\b|\bdoes not automatically renew\b/i;

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
    if (f.kind === 'auto_renew' && f.verification === 'verified' && NO_RENEW.test(f.quote)) {
      f.verification = 'unverified';
      f.reason = 'The quoted words say it does not renew.';
    }
    if (f.kind === 'trial_conversion' && f.verification === 'verified' && !looksLikeFreeTrial(f.quote, page)) {
      // Keep the price, drop the trial: it is the regular charge after an intro price.
      f.kind = 'recurring_charge';
      delete f.trialLength;
      delete f.trialUnit;
      f.note = 'This looks like a paid intro price, not a free trial.';
    }
    // A reminder date is only worked out from a verified quote that itself
    // contains the trial length, so a made-up number can never set a reminder.
    if (f.verification === 'verified' && f.kind === 'trial_conversion' && r.trialLength && r.trialUnit
      && new RegExp(`\\b${r.trialLength}[-\\s]?(day|week|month)`, 'i').test(r.quote)) {
      const d = addTrial(start, r.trialLength, r.trialUnit);
      if (d) f.convertsOn = localDate(d);
    }
    return f;
  });
}
