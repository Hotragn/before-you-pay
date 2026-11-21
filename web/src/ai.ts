import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  Schema,
  type GenerativeModel,
} from 'firebase/ai';
import { getFirebaseApp } from './firebase';
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

export function models() {
  const app = getFirebaseApp();
  if (!app) return undefined;
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  privateModel ??= getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        initialPrompts: [{ role: 'system', content: [{ type: 'text', value: PAGE_INSTRUCTIONS }] }],
      },
      promptOptions: { responseConstraint: findingsJsonSchema },
    },
  });
  publicModel ??= getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: {
      model: 'gemini-3.5-flash-lite',
      generationConfig: { responseMimeType: 'application/json', responseSchema: cancelStepsSchema },
    },
  });
  return { privateModel, publicModel };
}

// Must be called from a click handler (Chrome needs a user gesture to start
// the model download).
export async function prepareOnDevice(onProgress: (p: number) => void): Promise<boolean> {
  const m = models();
  if (!m) return false;
  try {
    await m.privateModel.initializeDeviceModel(onProgress);
    return true;
  } catch {
    return false;
  }
}

export function pageToPrompt(page: PageSnapshot, maxChars = 6000): string {
  const boxes = page.checkboxes.map((c) => `[${c.checked ? 'x' : ' '}] ${c.label}`).join('\n');
  return `Page: ${page.title}\n\n${page.text.slice(0, maxChars)}\n\nCheckboxes:\n${boxes}`;
}

export async function analyzeOnDevice(page: PageSnapshot): Promise<{ findings: RawFinding[]; source: string }> {
  const m = models();
  if (!m) throw new Error('Firebase is not configured');
  const result = await m.privateModel.generateContent(pageToPrompt(page));
  const parsed = JSON.parse(result.response.text()) as { findings: RawFinding[] };
  return { findings: parsed.findings ?? [], source: result.response.inferenceSource ?? 'on_device' };
}

export interface CancelSteps {
  steps: string[];
  noticeNeeded?: string;
  refundPolicy?: string;
  quotes: string[];
}

// Public page only. The caller passes the text of the terms page, never the
// checkout page.
export async function cancelStepsInCloud(termsText: string): Promise<{ data: CancelSteps; source: string }> {
  const m = models();
  if (!m) throw new Error('Firebase is not configured');
  const prompt = `This is a company's public terms or cancellation page. Explain, as short steps,
how a customer cancels a subscription, how much notice is needed, and the refund policy.
Copy the sentences you relied on into "quotes", word for word.\n\n${termsText.slice(0, 60000)}`;
  const result = await m.publicModel.generateContent(prompt);
  return { data: JSON.parse(result.response.text()) as CancelSteps, source: result.response.inferenceSource ?? 'in_cloud' };
}
