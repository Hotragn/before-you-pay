// "What left this device": a list of every read in this tab, which mode it
// used, how much text was involved, and for cloud reads the exact text sent.
// It is kept in memory only. The request count comes from the browser's own
// resource timing list (PerformanceObserver), filtered to the Gemini API host.
// It is what the page itself measured, not a network capture.

export type Where = 'on_device' | 'in_cloud' | 'none';
export interface Entry {
  at: Date;
  what: string; // "Checkout page", "Checkout page, redacted copy", "Terms page"
  where: Where;
  chars: number;
  sha256: string;
  sent?: string; // only for cloud reads: the exact text that went out
  requests: number | null; // Gemini API requests seen during this read
  reused?: boolean; // answer came from an earlier read, nothing sent this time
  personal?: string[]; // kinds of details that stayed on the device
}

export const AI_HOSTS = /firebasevertexai\.googleapis\.com|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/;
export const ledger: Entry[] = [];

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Counts requests to the Gemini API made while fn runs.
export async function watchRequests<T>(fn: () => Promise<T>): Promise<{ value: T; requests: number | null }> {
  if (typeof PerformanceObserver === 'undefined') return { value: await fn(), requests: null };
  let n = 0;
  const seen = new Set<PerformanceEntry>();
  const count = (list: PerformanceEntryList) => { for (const e of list) if (!seen.has(e) && AI_HOSTS.test(e.name)) { seen.add(e); n++; } };
  const obs = new PerformanceObserver((l) => count(l.getEntries()));
  const start = performance.now();
  try { obs.observe({ type: 'resource', buffered: false }); } catch { return { value: await fn(), requests: null }; }
  try {
    const value = await fn();
    // Resource entries arrive when a response finishes, so take a last look.
    await new Promise((r) => setTimeout(r, 300));
    count(performance.getEntriesByType('resource').filter((e) => e.startTime >= start));
    return { value, requests: n };
  } finally {
    obs.disconnect();
  }
}

export async function record(e: Omit<Entry, 'at' | 'sha256' | 'chars'> & { text: string }): Promise<Entry> {
  const entry: Entry = { ...e, at: new Date(), chars: e.text.length, sha256: await sha256(e.text) };
  delete (entry as Partial<{ text: string }>).text;
  if (e.where === 'in_cloud') entry.sent = e.text;
  ledger.unshift(entry);
  return entry;
}

// Splits redacted text into plain parts and [email]-style markers, so the
// panel can show what was taken out without ever showing the values.
export function markRedactions(text: string): { text: string; removed: boolean }[] {
  const out: { text: string; removed: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[(?:email|card number|card ending|phone|street address|zip)\]/g)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), removed: false });
    out.push({ text: m[0], removed: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), removed: false });
  return out;
}
