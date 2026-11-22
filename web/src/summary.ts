import type { Finding } from './types';

const value = (a?: string) => (a ? Number(a.replace(/[^\d.]/g, '')) : 0);
const fmt = (n: number, like?: string) => `${like?.match(/^[^\d]*/)?.[0] || '$'}${n.toFixed(2)}`;

// One plain sentence a person can read in two seconds. Built only from
// verified findings, with arithmetic done here and never by a model.
export function summaryLine(findings: Finding[]): string {
  const v = findings.filter((f) => f.verification === 'verified');
  const trial = v.find((f) => f.kind === 'trial_conversion' && f.convertsOn && f.amount);
  const addons = v.filter((f) => f.kind === 'prechecked_addon' && f.amount);
  const fees = v.filter((f) => f.kind === 'fee' && f.amount);
  const parts: string[] = [];
  const due = v.find((f) => f.kind === 'due_today' && f.amount);
  if (trial) {
    const day = new Date(trial.convertsOn + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const today = due && value(due.amount) > 0 ? `${due.amount} today` : 'Free today';
    parts.push(`${today}, then ${trial.amount} from ${day}`);
  } else if (due && value(due.amount) > 0) {
    parts.push(`${due.amount} due today`);
  }
  if (addons.length) {
    const sum = addons.reduce((s, f) => s + value(f.amount), 0);
    parts.push(`${fmt(sum, addons[0].amount)} more for ${addons.length} add-on${addons.length > 1 ? 's' : ''} that ${addons.length > 1 ? 'were' : 'was'} already ticked`);
  }
  if (fees.length) parts.push(`fees: ${fees.map((f) => f.amount).join(', ')}`);
  return parts.length ? parts.join('; ') + '.' : '';
}
