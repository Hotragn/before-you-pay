import type { Finding } from './types';
import { normalize } from './verify';

// Keep one card per (kind, quote). Model findings win over rule findings for the
// same quote because they usually carry better structure.
export function mergeFindings(...lists: Finding[][]): Finding[] {
  const out = new Map<string, Finding>();
  for (const list of lists) {
    for (const f of list) {
      const key = `${f.kind}|${normalize(f.quote).slice(0, 80)}`;
      const prev = out.get(key);
      if (!prev || (prev.source === 'rules' && f.source !== 'rules' && f.verification === 'verified')) out.set(key, f);
    }
  }
  const order = ['due_today', 'trial_conversion', 'recurring_charge', 'prechecked_addon', 'fee', 'auto_renew', 'cancel_path'];
  return [...out.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
