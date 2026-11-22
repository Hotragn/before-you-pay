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

async function loadPage(id: string): Promise<PageSnapshot> {
  const html = await (await fetch(`/eval/fixtures/${id}.html`)).text();
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:absolute;left:-9999px;width:900px;height:1400px';
  frame.srcdoc = html;
  document.body.append(frame);
  await new Promise((r) => (frame.onload = r));
  const snap = snapshotDocument(frame.contentDocument!, `https://${id}.demo.example/checkout`);
  frame.remove();
  return { ...snap, capturedAt: '2026-11-22T15:00:00.000Z' };
}

async function run(mode: Mode) {
  const labels = (await (await fetch('/eval/labels.json')).json()) as Record<string, Labels>;
  if (mode === 'device' && !(await prepareOnDevice((p) => (status.textContent = `Model download ${Math.round(p * 100)}%`)))) {
    status.textContent = 'No on-device model on this computer.';
    return;
  }
  const rows: { id: string; ms: number; s: Score; modelFindings: number; modelUnverified: number; error?: string; findings: Finding[] }[] = [];
  for (const id of Object.keys(labels)) {
    status.textContent = `${mode}: ${id}`;
    // The free cloud quota allows only a few requests a minute, so pace them.
    if (mode === 'cloud' && rows.length) await new Promise((r) => setTimeout(r, 5000));
    const page = await loadPage(id);
    const t0 = performance.now();
    let found: Finding[] = [];
    let error: string | undefined;
    let model: Finding[] = [];
    try {
      // Every mode includes the basic check, the way the product works.
      const base = verifyFindings(ruleFindings(page), page, 'rules');
      if (mode === 'rules') found = base;
      else if (mode === 'device') {
        model = verifyFindings((await analyzeOnDevice(page)).findings, page, 'on_device');
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
      modelUnverified: model.filter((f) => f.verification !== 'verified').length, error, findings: found });
  }
  const ok = rows.filter((r) => !r.error);
  const result = { mode, when: new Date().toISOString(), settings: currentSettings(),
    modelFindings: ok.reduce((n, r) => n + r.modelFindings, 0), modelUnverified: ok.reduce((n, r) => n + r.modelUnverified, 0),
    medianMs: ok.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(ok.length / 2)] ?? null, summary: summarize(rows.filter((r) => !r.error).map((r) => r.s)), errors: rows.filter((r) => r.error).length, rows };
  (window as unknown as { evalResult: unknown }).evalResult = result;
  out.textContent = JSON.stringify(result, null, 2);
  status.textContent = `Done: ${mode}`;
}

for (const m of ['rules', 'device', 'cloud'] as Mode[]) document.getElementById(m)!.onclick = () => run(m);
