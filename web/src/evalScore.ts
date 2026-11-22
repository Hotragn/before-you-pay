import type { Finding } from './types';

export interface Labels {
  trial: null | { length: number; unit: string; paid_amount: string | null };
  recurring: string[];
  auto_renew: boolean;
  prechecked_paid_addons: string[];
  fees: string[];
  has_cancel_or_terms_link: boolean;
}

const money = (a?: string) => (a ? Number(a.replace(/[^\d.]/g, '')).toFixed(2) : '');
const set = (xs: (string | undefined)[]) => new Set(xs.filter(Boolean).map(money));
const PER = /\/\s?(mo|month|yr|year|wk|week)|per\s+(month|year|week)|every|monthly|annually|yearly|billed/i;

export interface Score {
  tp: number; fp: number; fn: number; // over amount sets
  trialOk: boolean | null; renewOk: boolean; linkOk: boolean;
  unverified: number;
}

// Only verified findings count. A finding the code could not tie to the page
// is shown to the user as "check this line", so it is not a claim.
export function score(found: Finding[], labels: Labels): Score {
  const v = found.filter((f) => f.verification === 'verified');
  const trials = v.filter((f) => f.kind === 'trial_conversion');
  const trial = trials.find((f) => f.amount) ?? trials[0];
  const predRecurring = set([
    ...v.filter((f) => f.kind === 'recurring_charge').map((f) => f.amount),
    trial?.amount,
    ...v.filter((f) => f.kind === 'prechecked_addon' && PER.test(f.quote)).map((f) => f.amount),
  ]);
  const predAddons = set(v.filter((f) => f.kind === 'prechecked_addon').map((f) => f.amount));
  const predFees = set(v.filter((f) => f.kind === 'fee').map((f) => f.amount));
  let tp = 0, fp = 0, fn = 0;
  for (const [pred, gold] of [
    [predRecurring, set(labels.recurring)],
    [predAddons, set(labels.prechecked_paid_addons)],
    [predFees, set(labels.fees)],
  ] as [Set<string>, Set<string>][]) {
    for (const a of pred) (gold.has(a) ? tp++ : fp++);
    for (const a of gold) if (!pred.has(a)) fn++;
  }
  let trialOk: boolean | null = null;
  if (labels.trial || trial) {
    trialOk = Boolean(labels.trial && trial && trial.trialLength === labels.trial.length
      && trial.trialUnit === labels.trial.unit
      && (!labels.trial.paid_amount || money(trial.amount) === money(labels.trial.paid_amount)));
  }
  return {
    tp, fp, fn, trialOk,
    renewOk: v.some((f) => f.kind === 'auto_renew') === labels.auto_renew,
    linkOk: v.some((f) => f.kind === 'cancel_path') === labels.has_cancel_or_terms_link,
    unverified: found.length - v.length,
  };
}

export function summarize(scores: Score[]) {
  const s = scores.reduce((a, b) => ({ tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn }), { tp: 0, fp: 0, fn: 0 });
  const trials = scores.filter((x) => x.trialOk !== null);
  return {
    pages: scores.length,
    amountPrecision: s.tp / Math.max(1, s.tp + s.fp),
    amountRecall: s.tp / Math.max(1, s.tp + s.fn),
    trialAccuracy: trials.filter((x) => x.trialOk).length / Math.max(1, trials.length),
    trialPages: trials.length,
    renewAccuracy: scores.filter((x) => x.renewOk).length / Math.max(1, scores.length),
    linkAccuracy: scores.filter((x) => x.linkOk).length / Math.max(1, scores.length),
    unverifiedFindings: scores.reduce((a, b) => a + b.unverified, 0),
  };
}
