import type { Finding } from './types';
import { normalize } from './verify';

const money = (a?: string) => (a ? Number(a.replace(/[^\d.]/g, '')).toFixed(2) : '');

// One card per fact. Two findings are the same fact when they have the same kind
// and the same amount (or, for trials, the same length), even if they quote
// different sentences. Verified beats unverified, a model finding beats the
// basic check, and missing fields are filled from the other finding.
function keyOf(f: Finding): string {
  if (f.kind === 'trial_conversion' && f.trialLength) {
    // Models sometimes leave the unit as "unknown", so the length alone decides.
    return `trial|${Number(f.trialLength)}`;
  }
  // "Renews automatically" is one fact however it is quoted. Nano sometimes
  // attaches the plan price to it, which must not make a second card.
  if (f.kind === 'auto_renew') return 'auto_renew';
  if (f.amount) return `${f.kind}|${money(f.amount)}`;
  return `${f.kind}|${normalize(f.quote).slice(0, 80)}`;
}

function rank(f: Finding): number {
  return (f.verification === 'verified' ? 4 : 0) + (f.source === 'rules' ? 0 : 2) + (f.amount ? 1 : 0);
}

export function mergeFindings(...lists: Finding[][]): Finding[] {
  const out = new Map<string, Finding>();
  for (const f of lists.flat()) {
    const k = keyOf(f);
    const prev = out.get(k);
    if (!prev) { out.set(k, f); continue; }
    const [win, lose] = rank(f) > rank(prev) ? [f, prev] : [prev, f];
    out.set(k, {
      ...win,
      amount: win.amount ?? (lose.verification === 'verified' ? lose.amount : undefined),
      convertsOn: win.convertsOn ?? (lose.verification === 'verified' ? lose.convertsOn : undefined),
    });
  }
  // "Becomes $14.99 on Dec 6" already says it recurs at $14.99.
  const trialAmounts = new Set([...out.values()].filter((f) => f.kind === 'trial_conversion' && f.amount).map((f) => money(f.amount)));
  for (const [k, f] of out) if (f.kind === 'recurring_charge' && f.amount && trialAmounts.has(money(f.amount))) out.delete(k);
  // Cancel and terms links from the basic check come from real links on the page.
  // When we have those, a model's cancel_path card only repeats them in prose.
  const hasRealLinks = [...out.values()].some((f) => f.kind === 'cancel_path' && f.source === 'rules');
  if (hasRealLinks) for (const [k, f] of out) if (f.kind === 'cancel_path' && f.source !== 'rules') out.delete(k);
  const order = ['due_today', 'trial_conversion', 'recurring_charge', 'prechecked_addon', 'fee', 'auto_renew', 'cancel_path'];
  return [...out.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
