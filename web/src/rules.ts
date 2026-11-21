import type { PageSnapshot, RawFinding } from './types';
import { amountsIn } from './verify';

// Plain pattern matching that needs no model. It runs first on every page, it is
// the whole analysis when no on-device model is available, and it gives the
// model's answers something to be checked against.
const TRIAL = /(\d{1,3})[-\s]?(day|week|month)s?\s+(?:free\s+)?trial/i;
const RENEW = /(auto(?:matically)?[-\s]?renew\w*|renews? automatically|until you cancel|until cancell?ed|recurring)/i;
const PER = /(\/\s?(mo|month|yr|year|wk|week)|per\s+(month|year|week)|a\s+(month|year)|monthly|annually|yearly)/i;
const CANCEL = /cancel/i;
const FEE = /\b(fee|surcharge|service charge|processing charge)\b/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3 && s.length < 400);
}

function periodOf(s: string): RawFinding['period'] {
  const m = s.match(PER)?.[0]?.toLowerCase() ?? '';
  if (/mo|month/.test(m)) return 'month';
  if (/yr|year|annual/.test(m)) return 'year';
  if (/wk|week/.test(m)) return 'week';
  return 'unknown';
}

export function ruleFindings(page: PageSnapshot): RawFinding[] {
  const out: RawFinding[] = [];
  const all = sentences(page.text);
  const paid = (x: string) => amountsIn(x).find((a) => !/^\D?0(\.00)?$/.test(a));
  const boxLabels = new Set(page.checkboxes.map((c) => c.label.trim().toLowerCase()));
  for (const [i, s] of all.entries()) {
    if (boxLabels.has(s.toLowerCase())) continue; // handled with the checkboxes below
    const t = s.match(TRIAL);
    if (t) {
      // The price is often in the next sentence: "After your trial, it's $14.99/month."
      const next = all.slice(i + 1, i + 3).find((x) => /after (your|the) (free )?trial|then|thereafter/i.test(x) && paid(x));
      out.push({
        kind: 'trial_conversion',
        quote: s,
        amount: paid(s) ?? (next ? paid(next) : undefined),
        trialLength: Number(t[1]),
        trialUnit: t[2].toLowerCase() as RawFinding['trialUnit'],
        period: periodOf(s),
      });
      continue;
    }
    if (FEE.test(s) && paid(s)) out.push({ kind: 'fee', quote: s, amount: paid(s), period: PER.test(s) ? periodOf(s) : 'once' });
    else if (RENEW.test(s)) out.push({ kind: 'auto_renew', quote: s });
    else if (PER.test(s) && amountsIn(s).length) {
      out.push({ kind: 'recurring_charge', quote: s, amount: amountsIn(s)[0], period: periodOf(s) });
    }
  }
  for (const c of page.checkboxes) {
    if (c.checked && amountsIn(c.label).length) {
      out.push({ kind: 'prechecked_addon', quote: c.label, amount: amountsIn(c.label)[0] });
    }
  }
  for (const l of page.links) {
    if (CANCEL.test(l.text) || /terms|subscription/i.test(l.text)) {
      out.push({ kind: 'cancel_path', quote: l.text });
    }
  }
  return out;
}
