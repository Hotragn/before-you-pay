import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  Schema,
  type GenerativeModel,
} from 'firebase/ai';
import { getFirebaseApp } from './firebase';
import { defaults, type Settings } from './settings';
import { CREATE_OPTIONS_BASE, planParts } from './nano';
import type { PageSnapshot, RawFinding } from './types';

// Two models, two modes, on purpose.
//
// 1. The checkout page holds the user's name, address, email and card ending.
//    It goes to ONLY_ON_DEVICE. If there is no on-device model we never quietly
//    fall back to the cloud (PREFER_ON_DEVICE would do exactly that).
// 2. The linked terms / cancellation page is public and often far longer than
//    the on-device context. It goes to ONLY_IN_CLOUD and carries no user data.

const KINDS = ['due_today', 'trial_conversion', 'recurring_charge', 'auto_renew', 'prechecked_addon', 'fee', 'cancel_path'];

// JSON schema for the on-device Prompt API (responseConstraint).
export const findingsJsonSchema = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: KINDS },
          quote: { type: 'string' },
          amount: { type: 'string' },
          period: { type: 'string', enum: ['day', 'week', 'month', 'year', 'once', 'unknown'] },
          trialLength: { type: 'number' },
          trialUnit: { type: 'string', enum: ['day', 'week', 'month', 'unknown'] },
        },
        required: ['kind', 'quote'],
      },
    },
  },
  required: ['findings'],
};

const PAGE_INSTRUCTIONS = `You read checkout and signup pages for the person about to pay.
List only things that cost money or commit them to future charges:
what is due today, when a free trial turns into a paid plan and at what price,
recurring charges, automatic renewal, add-ons that are already ticked, extra fees,
and how to cancel.
For every item, "quote" must be copied word for word from the page text.
Never calculate dates or totals. Give the trial length as a number and a unit.
If you are not sure, leave the item out.`;

export const cancelStepsSchema = Schema.object({
  properties: {
    steps: Schema.array({ items: Schema.string() }),
    noticeNeeded: Schema.string(),
    refundPolicy: Schema.string(),
    quotes: Schema.array({ items: Schema.string() }),
  },
  optionalProperties: ['noticeNeeded', 'refundPolicy'],
});

let privateModel: GenerativeModel | undefined;
let publicModel: GenerativeModel | undefined;
let redactedModel: GenerativeModel | undefined;

let modelFor = '';
let current: Settings = defaults;
export function useSettings(s: Settings) { current = s; }
export function currentSettings(): Settings { return current; }

export function models(settings: Settings = current) {
  if (modelFor !== settings.cloud_model) { publicModel = undefined; redactedModel = undefined; modelFor = settings.cloud_model; }
  const app = getFirebaseApp();
  const ai = getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true });
  privateModel ??= getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        ...CREATE_OPTIONS_BASE,
        initialPrompts: [{ role: 'system', content: [{ type: 'text', value: PAGE_INSTRUCTIONS }] }],
      },
      promptOptions: { responseConstraint: findingsJsonSchema },
    },
  });
  publicModel ??= getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: settings.cloud_model,
      generationConfig: { responseMimeType: 'application/json', responseSchema: cancelStepsSchema },
    },
  });
  // Only used after the user agrees, on a copy with personal details removed.
  redactedModel ??= getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: settings.cloud_model,
      systemInstruction: PAGE_INSTRUCTIONS,
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: findingsJsonSchema },
    },
  });
  return { privateModel, publicModel, redactedModel };
}

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available' | 'no-api';

// Ask Chrome directly whether an on-device model can run here, so we can show
// an honest message instead of waiting for an error.
export async function onDeviceAvailability(): Promise<Availability> {
  const LM = (globalThis as unknown as { LanguageModel?: { availability(o?: object): Promise<Availability> } }).LanguageModel;
  if (!LM) return 'no-api';
  try {
    return await LM.availability(CREATE_OPTIONS_BASE);
  } catch {
    return 'unavailable';
  }
}

// Must be called from a click handler (Chrome needs a user gesture to start
// the model download).
export async function prepareOnDevice(onProgress: (p: number) => void): Promise<boolean> {
  const a = await onDeviceAvailability();
  if (a === 'no-api' || a === 'unavailable') return false;
  const m = models();
  try {
    await m.privateModel.initializeDeviceModel(onProgress);
    return true;
  } catch {
    return false;
  }
}

// Fine print usually sits at the bottom of a checkout page, so a long page
// keeps its start and its last part instead of being cut at the end.
function parseFindings(text: string): RawFinding[] {
  try {
    return (JSON.parse(text) as { findings?: RawFinding[] }).findings ?? [];
  } catch {
    throw new Error('The model sent back something that was not a list of findings. Try again.');
  }
}

export function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const tail = Math.min(2500, Math.floor(maxChars / 2));
  return `${text.slice(0, maxChars - tail)}\n[...]\n${text.slice(-tail)}`;
}

export function pageToPrompt(page: PageSnapshot, maxChars = current.max_page_chars): string {
  const boxes = page.checkboxes.map((c) => `[${c.checked ? 'x' : ' '}] ${c.label}`).join('\n');
  return `Page: ${page.title}\n\n${clip(page.text, maxChars)}\n\nCheckboxes:\n${boxes}`;
}

export interface DeviceRead { findings: RawFinding[]; source: string; parts: number; tokens: number; exact: boolean; trimmed: boolean }

function aborted(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }));
}

// Reads the page on the device. Long pages are measured and split so each part
// fits Gemini Nano's context window (see nano.ts). The Prompt API has no way
// to cancel a running prompt through the SDK, so Stop drops the answer and the
// next request starts a fresh session.
export async function analyzeOnDevice(
  page: PageSnapshot, opts: { signal?: AbortSignal; onPart?: (i: number, n: number) => void } = {},
): Promise<DeviceRead> {
  const m = models();
  // Whole page text (up to the snapshot limit) instead of a fixed cut.
  const plan = await planParts(page, (p) => pageToPrompt(p, 20000), PAGE_INSTRUCTIONS);
  const findings: RawFinding[] = [];
  let source = 'on_device';
  for (const [i, prompt] of plan.prompts.entries()) {
    if (opts.signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    opts.onPart?.(i + 1, plan.prompts.length);
    const result = await Promise.race([m.privateModel.generateContent(prompt), aborted(opts.signal)]);
    findings.push(...parseFindings(result.response.text()));
    source = result.response.inferenceSource ?? source;
  }
  return { findings, source, parts: plan.prompts.length, tokens: plan.budget.used, exact: plan.budget.exact, trimmed: plan.trimmed };
}

export interface CancelSteps {
  steps: string[];
  noticeNeeded?: string;
  refundPolicy?: string;
  quotes: string[];
}

// Public page only. The caller passes the text of the terms page, never the
// checkout page.
export async function cancelStepsInCloud(termsText: string, signal?: AbortSignal): Promise<{ data: CancelSteps; source: string }> {
  const m = models();
  const prompt = `This is a company's public terms or cancellation page. Explain, as short steps,
how a customer cancels a subscription, how much notice is needed, and the refund policy.
Copy the sentences you relied on into "quotes", word for word.\n\n${termsText.slice(0, 60000)}`;
  const result = await m.publicModel.generateContent(prompt, signal ? { signal, timeout: 45000 } : undefined);
  return { data: JSON.parse(result.response.text()) as CancelSteps, source: result.response.inferenceSource ?? 'in_cloud' };
}

export async function analyzeRedactedInCloud(redactedPage: PageSnapshot, signal?: AbortSignal): Promise<{ findings: RawFinding[]; source: string }> {
  const m = models();
  const result = await m.redactedModel.generateContent(pageToPrompt(redactedPage, current.max_page_chars * 2), signal ? { signal, timeout: 45000 } : undefined);
  return { findings: parseFindings(result.response.text()), source: result.response.inferenceSource ?? 'in_cloud' };
}
