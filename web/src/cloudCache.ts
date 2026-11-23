import type { Settings } from './settings';

// The demo runs on the free Firebase plan, which allows only a few cloud
// requests a minute. Three things keep it usable when several people try it:
//
// 1. Results of cloud reads are kept in this browser, keyed by a hash of the
//    exact text sent, so pressing the same button twice costs nothing.
// 2. For our own demo store and its terms page only, a saved result from a
//    real cloud read is shipped in /demo-cache.json. The panel says when it
//    shows one, with the date, and the next press does a fresh read.
// 3. Calls are spaced out (Remote Config: cloud_cooldown_seconds), and one
//    retry is made after a short wait if the quota answers "429".
// 4. If a fresh read of our demo store fails (quota, App Check, network), the
//    saved result is shown again with a note saying the fresh read failed, so
//    a judge never ends up with an empty panel.

export interface CloudResult<T> { value: T; source: string; cached?: 'browser' | 'saved'; savedAt?: string; freshError?: string }
interface Entry { kind: string; value: unknown; source: string; at: string }

let demoCache: Promise<Record<string, Entry>> | undefined;
const skipped = new Set<string>();
let lastCall = 0;
// Every real cloud read in this tab, so a saved demo result can be built from
// real calls (see scripts/build-demo-cache.mjs). Nothing here leaves the page.
export const cloudLog: (Entry & { key: string })[] = [];
(globalThis as unknown as { bypCloudLog: typeof cloudLog }).bypCloudLog = cloudLog;

export async function hashKey(kind: string, text: string, s: Settings): Promise<string> {
  const data = new TextEncoder().encode(`${kind}|${s.cloud_model}|${s.prompt_version}|${text}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function loadDemoCache(): Promise<Record<string, Entry>> {
  demoCache ??= fetch('/demo-cache.json').then((r) => (r.ok ? r.json() : { entries: {} })).then((j) => j.entries ?? {}).catch(() => ({}));
  return demoCache;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isQuota = (e: unknown) => /\b429\b|quota/i.test((e as Error)?.message ?? '');

export async function cloudOnce<T>(
  kind: string, text: string, s: Settings, run: () => Promise<{ value: T; source: string }>,
  onWait: (msg: string) => void, allowSaved: boolean,
): Promise<CloudResult<T>> {
  const key = await hashKey(kind, text, s);
  const fresh = skipped.has(key);
  if (!fresh) {
    const local = localStorage.getItem(`byp.cloud.${key}`);
    if (local) { skipped.add(key); const e = JSON.parse(local) as Entry; return { value: e.value as T, source: e.source, cached: 'browser', savedAt: e.at }; }
    if (allowSaved) {
      const saved = (await loadDemoCache())[key];
      if (saved) { skipped.add(key); return { value: saved.value as T, source: saved.source, cached: 'saved', savedAt: saved.at }; }
    }
  }
  const wait = lastCall + s.cloud_cooldown_seconds * 1000 - Date.now();
  if (wait > 0) { onWait('Waiting a few seconds to stay inside the free cloud quota...'); await sleep(wait); }
  lastCall = Date.now();
  let out: { value: T; source: string };
  try {
    try {
      out = await run();
    } catch (e) {
      if (!isQuota(e)) throw e;
      onWait('Gemini in the cloud is busy. Trying again in 15 seconds...');
      await sleep(15000);
      lastCall = Date.now();
      out = await run();
    }
  } catch (e) {
    // Stop means stop. Anything else on our own demo pages falls back to the
    // saved real read, and the caller says that the fresh read failed.
    const saved = allowSaved && (e as Error)?.name !== 'AbortError' ? (await loadDemoCache())[key] : undefined;
    if (!saved) throw e;
    return { value: saved.value as T, source: saved.source, cached: 'saved', savedAt: saved.at, freshError: (e as Error)?.message ?? String(e) };
  }
  const entry: Entry = { kind, value: out.value, source: out.source, at: new Date().toISOString() };
  cloudLog.push({ key, ...entry });
  try { localStorage.setItem(`byp.cloud.${key}`, JSON.stringify(entry)); } catch { /* storage full is fine */ }
  skipped.delete(key);
  return out;
}

