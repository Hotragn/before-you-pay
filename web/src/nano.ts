import type { PageSnapshot } from './types';

// Gemini Nano runs with a small context window, and checkout pages can be long.
// Before each read we measure the prompt with Chrome's own token counter and,
// if it does not fit, split the page into parts that do. Each part is a normal
// Firebase AI Logic ONLY_ON_DEVICE request, and the findings are merged after
// every quote is checked against the whole page.
//
// Session use: the Firebase SDK starts a fresh Prompt API session for each
// request, which is what we want, because one page must never leak into the
// read of the next. We keep one extra session alive just for measuring. It
// never receives a prompt, it keeps the model loaded between reads, and it is
// thrown away when the panel is hidden.

export const CREATE_OPTIONS_BASE = {
  expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};

interface Session {
  inputQuota?: number; inputUsage?: number; // Chrome 138+
  contextWindow?: number; contextUsage?: number; // newer names
  measureInputUsage?(input: string): Promise<number>;
  measureContextUsage?(input: string): Promise<number>;
  destroy(): void;
}
interface LM { create(o: object): Promise<Session> }

const OUTPUT_RESERVE = 1200; // tokens kept free for the JSON answer
const FALLBACK_QUOTA = 4096; // used only if Chrome does not report a quota
export const MAX_PARTS = 6;

let measurer: Promise<Session | null> | undefined;

export function measuringSession(systemPrompt: string): Promise<Session | null> {
  const lm = (globalThis as unknown as { LanguageModel?: LM }).LanguageModel;
  if (!lm) return Promise.resolve(null);
  measurer ??= lm.create({ ...CREATE_OPTIONS_BASE, initialPrompts: [{ role: 'system', content: [{ type: 'text', value: systemPrompt }] }] })
    .catch(() => null);
  return measurer;
}

export function dropMeasuringSession(): void {
  measurer?.then((s) => s?.destroy()).catch(() => {});
  measurer = undefined;
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.hidden) dropMeasuringSession(); });
}

export interface Budget { used: number; room: number; exact: boolean }

// How many tokens this prompt needs, and how many are free for it.
export async function measure(prompt: string, systemPrompt: string): Promise<Budget> {
  const s = await measuringSession(systemPrompt);
  const quota = s?.contextWindow ?? s?.inputQuota;
  const already = s?.contextUsage ?? s?.inputUsage ?? 0;
  const counter = s?.measureContextUsage?.bind(s) ?? s?.measureInputUsage?.bind(s);
  if (s && quota && counter) {
    try {
      return { used: await counter(prompt), room: quota - already - OUTPUT_RESERVE, exact: true };
    } catch { /* fall through to the estimate */ }
  }
  // About 4 characters per token for English text, rounded up to be safe.
  return { used: Math.ceil(prompt.length / 3.5), room: (quota ?? FALLBACK_QUOTA) - already - OUTPUT_RESERVE, exact: false };
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

// Split the page text into parts that each fit, keeping sentences whole.
// The ticked boxes go with every part, since they are short and matter most.
export async function planParts(
  page: PageSnapshot, toPrompt: (p: PageSnapshot) => string, systemPrompt: string,
): Promise<{ prompts: string[]; budget: Budget; trimmed: boolean }> {
  const whole = toPrompt(page);
  const budget = await measure(whole, systemPrompt);
  if (budget.used <= budget.room) return { prompts: [whole], budget, trimmed: false };
  // Size the parts from the measured characters per token, with a margin.
  const overhead = toPrompt({ ...page, text: '' }).length;
  const charsPerToken = whole.length / budget.used;
  const target = Math.max(400, Math.floor(budget.room * charsPerToken * 0.85) - overhead);
  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences(page.text)) {
    if (cur && cur.length + s.length + 1 > target) { chunks.push(cur); cur = ''; }
    cur += (cur ? ' ' : '') + s;
  }
  if (cur) chunks.push(cur);
  // Too many parts: keep the start and the end, where the fine print usually is.
  let trimmed = chunks.length > MAX_PARTS;
  const keep = trimmed ? [...chunks.slice(0, MAX_PARTS - 1), chunks[chunks.length - 1]] : chunks;
  const prompts: string[] = [];
  for (const c of keep) {
    let text = c;
    let p = toPrompt({ ...page, text });
    // Safety net for very long sentences: shorten until it fits.
    for (let i = 0; i < 10 && (await measure(p, systemPrompt)).used > budget.room; i++) {
      text = text.slice(0, Math.floor(text.length * 0.8));
      p = toPrompt({ ...page, text });
      trimmed = true;
    }
    prompts.push(p);
  }
  return { prompts, budget, trimmed };
}
