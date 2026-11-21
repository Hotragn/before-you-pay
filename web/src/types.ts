// A snapshot of the page the user is about to pay on. Built by the extension's
// content script (or by the paste box on the web app). It can contain personal
// data, so it is only ever given to the on-device model.
export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  checkboxes: { label: string; checked: boolean }[];
  links: { text: string; href: string }[];
  capturedAt: string; // ISO time
}

export type FindingKind =
  | 'due_today'
  | 'trial_conversion'
  | 'recurring_charge'
  | 'auto_renew'
  | 'prechecked_addon'
  | 'fee'
  | 'cancel_path';

// What the model returns. The model never does math: it gives raw amounts and
// trial lengths, and our code works out dates and checks every quote.
export interface RawFinding {
  kind: FindingKind;
  quote: string;
  amount?: string;
  period?: 'day' | 'week' | 'month' | 'year' | 'once' | 'unknown';
  trialLength?: number;
  trialUnit?: 'day' | 'week' | 'month' | 'unknown';
}

export type Verification = 'verified' | 'unverified';

export interface Finding extends RawFinding {
  verification: Verification;
  reason?: string;
  convertsOn?: string; // ISO date, computed in code
  source: 'on_device' | 'in_cloud' | 'rules';
}
