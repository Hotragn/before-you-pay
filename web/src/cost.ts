import type { Finding, PageSnapshot } from './types';
import { normalize } from './verify';

// The first-year cost, added up in code from verified findings only. A model
// never does this math. Each line keeps the quote it came from, so the panel
// can highlight it on the page.

export type Period = 'week' | 'four_weeks' | 'month' | 'year' | 'bill' | 'once';
export interface CostLine { label: string; quote: string; amount: number; period: Period; count: number; subtotal: number; source: Finding['source'] }
export interface FirstYear {
  lines: CostLine[];
  total: number;
  firstBill: number; // what the first charge after the trial adds up to
  notAdded: { quote: string; why: string }[];
  plusTax: boolean;
  basePeriod?: Period;
}

const value = (a?: string) => (a ? Number(a.replace(/[^\d.]/g, '')) : NaN);

// Read the billing period from the words, never from the model's guess.
export function periodFromText(s: string): Period | undefined {
  const t = s.toLowerCase();
  if (/one[-\s]time|\bonce\b|single payment/.test(t)) return 'once';
  if (/every (?:4|four) weeks/.test(t)) return 'four_weeks';
  if (/every (?:bill|payment|charge|billing period)|each (?:bill|payment|billing period)/.test(t)) return 'bill';
  if (/\/\s?(?:mo|month)\b|per month|a month\b|each month|every month|monthly|\/mo\./.test(t)) return 'month';
  if (/\/\s?(?:yr|year)\b|per year|a year\b|each year|every year|annually|yearly/.test(t)) return 'year';
  if (/\/\s?(?:wk|week)\b|per week|a week\b|each week|every week|weekly/.test(t)) return 'week';
  return undefined;
}

const PER_YEAR: Record<Exclude<Period, 'bill' | 'once'>, number> = { week: 52, four_weeks: 13, month: 12, year: 1 };

// The period of an amount, from the words right after it ("$3.99 each month",
// "$2.49 to every bill"): in its own quote first, then anywhere on the page
// (a checkbox price often sits next to its label, not in it), then the whole quote.
function near(text: string, amt: string): Period | undefined {
  const re = new RegExp(`\\$\\s?${amt}(?![\\d])`, 'g');
  for (const m of text.matchAll(re)) {
    const p = periodFromText(text.slice(m.index!, m.index! + m[0].length + 30));
    if (p) return p;
  }
  return undefined;
}
function periodOf(f: Finding, page: PageSnapshot): Period | undefined {
  // A regex for the amount: "14.99" -> 14\.99, "15" or "15.00" -> 15(?:\.00)?
  const fixed = f.amount ? Number(f.amount.replace(/[^\d.]/g, '')).toFixed(2) : '';
  const amt = fixed.endsWith('.00') ? `${fixed.slice(0, -3)}(?:\\.00)?` : fixed.replace('.', '\\.');
  if (!amt) return periodFromText(f.quote);
  return near(f.quote, amt) ?? periodFromText(f.quote) ?? near(page.text, amt);
}

export function firstYear(findings: Finding[], page: PageSnapshot): FirstYear | undefined {
  const v = findings.filter((f) => f.verification === 'verified' && f.amount && Number.isFinite(value(f.amount)));
  const lines: CostLine[] = [];
  const notAdded: FirstYear['notAdded'] = [];
  const trial = v.find((f) => f.kind === 'trial_conversion' && !f.note);
  const plans = [...new Set(v.filter((f) => f.kind === 'recurring_charge').map((f) => value(f.amount).toFixed(2)))];
  // The plan price: the price after the free trial, or the one recurring price
  // on the page. A page listing several plans has no single total.
  const base = trial ?? (plans.length === 1 ? v.find((f) => f.kind === 'recurring_charge') : undefined);
  if (!base) return undefined;
  const basePeriod = periodOf(base, page);
  if (!basePeriod || basePeriod === 'once' || basePeriod === 'bill') return undefined;
  const bills = PER_YEAR[basePeriod];
  const add = (f: Finding, label: string, period: Period, count: number) => {
    const amount = value(f.amount);
    lines.push({ label, quote: f.quote, amount, period, count, subtotal: Math.round(amount * count * 100) / 100, source: f.source });
  };
  add(base, trial ? 'Plan, after the free trial' : 'Plan', basePeriod, bills);
  let firstBill = value(base.amount);
  for (const f of v) {
    if (f === base) continue;
    if (f.kind === 'prechecked_addon' || f.kind === 'fee') {
      const p = periodOf(f, page);
      const label = f.kind === 'prechecked_addon' ? 'Add-on that was already ticked' : 'Extra charge';
      if (!p) { notAdded.push({ quote: f.quote, why: 'the page does not say how often' }); continue; }
      if (p === 'once') {
        add(f, label, 'once', 1);
        if (/end of (?:the|your) trial|when (?:the|your) trial ends|first (?:bill|charge|payment)/i.test(f.quote)) firstBill += value(f.amount);
        continue;
      }
      if (p === 'bill') { add(f, label, basePeriod, bills); firstBill += value(f.amount); continue; }
      if (PER_YEAR[p]) {
        add(f, label, p, PER_YEAR[p]);
        if (p === basePeriod) firstBill += value(f.amount);
        continue;
      }
    }
    if (f.kind === 'due_today' && value(f.amount) > 0) add(f, 'Due today', 'once', 1);
    if (f.kind === 'trial_conversion' && f.note) notAdded.push({ quote: f.quote, why: 'an intro price, and the page does not say what comes after' });
    if (f.kind === 'recurring_charge' && f.amount && value(f.amount).toFixed(2) !== value(base.amount).toFixed(2)) {
      notAdded.push({ quote: f.quote, why: 'another price on the page, not clearly part of this plan' });
    }
  }
  const total = Math.round(lines.reduce((s, l) => s + l.subtotal, 0) * 100) / 100;
  const plusTax = /(?:plus|exclud\w*|not include\w*|do not include)\s+(?:applicable\s+)?tax|taxes may apply|plus tax/i.test(page.text);
  return { lines, total, firstBill: Math.round(firstBill * 100) / 100, notAdded, plusTax, basePeriod };
}

export const money = (n: number) => `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
export const periodWords: Record<Period, string> = { week: 'a week', four_weeks: 'every 4 weeks', month: 'a month', year: 'a year', bill: 'every bill', once: 'once' };
