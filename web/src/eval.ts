import { analyzeOnDevice, analyzeRedactedInCloud, currentSettings, prepareOnDevice } from './ai';
import { score, summarize, type Labels, type Score } from './evalScore';
import { redact } from './redact';
import { ruleFindings } from './rules';
import { snapshotDocument } from './snapshot';
import type { Finding, PageSnapshot } from './types';
import { verifyFindings } from './verify';
import { mergeFindings } from './merge';

const out = document.getElementById('out')!;
const status = document.getElementById('status')!;
type Mode = 'rules' | 'device' | 'cloud';
// ?set=heldout runs the six pages written after the free trial rule was added.
const SET = new URLSearchParams(location.search).get('set') === 'heldout' ? 'heldout' : 'main';
const DIR = SET === 'heldout' ? '/eval/heldout' : '/eval';
const FIXTURES = SET === 'heldout' ? '/eval/heldout' : '/eval/fixtures';

async function loadPage(id: string): Promise<PageSnapshot> {
  const html = await (await fetch(`${FIXTURES}/${id}.html`)).text();
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:absolute;left:-9999px;width:900px;height:1400px';
  frame.srcdoc = html;
  document.body.append(frame);
  await new Promise((r) => (frame.onload = r));
  const snap = snapshotDocument(frame.contentDocument!, `https://${id}.demo.example/checkout`);
  frame.remove();
  return { ...snap, capturedAt: '2026-11-22T15:00:00.000Z' };
}

async function run(mode: Mode, supplied?: { labels: Record<string, Labels>; pages: Record<string, PageSnapshot>; set: string }) {
  const labels = supplied?.labels ?? ((await (await fetch(`${DIR}/labels.json`)).json()) as Record<string, Labels>);
  if (mode === 'device' && !(await prepareOnDevice((p) => (status.textContent = `Model download ${Math.round(p * 100)}%`)))) {
    status.textContent = 'No on-device model on this computer.';
    return;
  }
  const rows: { id: string; ms: number; s: Score; modelFindings: number; modelUnverified: number; device?: Record<string, unknown>; error?: string; findings: Finding[] }[] = [];
  for (const id of Object.keys(labels)) {
    status.textContent = `${mode}: ${id}`;
    // The free cloud quota allows only a few requests a minute, so pace them.
    if (mode === 'cloud' && rows.length) await new Promise((r) => setTimeout(r, 5000));
    const page = supplied ? supplied.pages[id] : await loadPage(id);
    const t0 = performance.now();
    let found: Finding[] = [];
    let error: string | undefined;
    let model: Finding[] = [];
    let device: Record<string, unknown> | undefined;
    try {
      // Every mode includes the basic check, the way the product works.
      const base = verifyFindings(ruleFindings(page), page, 'rules');
      if (mode === 'rules') found = base;
      else if (mode === 'device') {
        const read = await analyzeOnDevice(page);
        device = { parts: read.parts, tokens: read.tokens, exactTokens: read.exact, trimmed: read.trimmed };
        model = verifyFindings(read.findings, page, 'on_device');
        found = mergeFindings(base, model);
      } else {
        const safe = { ...page, text: redact(page.text), checkboxes: page.checkboxes.map((c) => ({ ...c, label: redact(c.label) })) };
        model = verifyFindings((await analyzeRedactedInCloud(safe)).findings, safe, 'in_cloud');
        found = mergeFindings(base, model);
      }
    } catch (e) {
      error = (e as Error).message;
    }
    // modelUnverified counts what the model said before merging, so cards that
    // failed the quote check are counted even if a verified card replaced them.
    rows.push({ id, ms: Math.round(performance.now() - t0), s: score(found, labels[id]), modelFindings: model.length,
      modelUnverified: model.filter((f) => f.verification !== 'verified').length, device, error, findings: found });
  }
  const ok = rows.filter((r) => !r.error);
  const result = { mode, set: supplied?.set ?? SET, when: new Date().toISOString(), settings: currentSettings(),
    modelFindings: ok.reduce((n, r) => n + r.modelFindings, 0), modelUnverified: ok.reduce((n, r) => n + r.modelUnverified, 0),
    medianMs: ok.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(ok.length / 2)] ?? null, summary: summarize(rows.filter((r) => !r.error).map((r) => r.s)), errors: rows.filter((r) => r.error).length, rows };
  (window as unknown as { evalResult: unknown }).evalResult = result;
  out.textContent = JSON.stringify(result, null, 2);
  status.textContent = `Done: ${mode}`;
}

for (const m of ['rules', 'device', 'cloud'] as Mode[]) document.getElementById(m)!.onclick = () => run(m);
// Lets a local script score page snapshots it saved itself (the real-page study),
// so those snapshots never have to be hosted.
(window as unknown as { bypRunSnapshots: typeof run }).bypRunSnapshots = run;
