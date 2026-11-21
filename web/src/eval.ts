import { analyzeOnDevice, analyzeRedactedInCloud, prepareOnDevice } from './ai';
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
  const rows: { id: string; ms: number; s: Score; error?: string; findings: Finding[] }[] = [];
  for (const id of Object.keys(labels)) {
    status.textContent = `${mode}: ${id}`;
    const page = await loadPage(id);
    const t0 = performance.now();
    let found: Finding[] = [];
    let error: string | undefined;
    try {
      // Every mode includes the basic check, the way the product works.
      const base = verifyFindings(ruleFindings(page), page, 'rules');
      if (mode === 'rules') found = base;
      else if (mode === 'device') found = mergeFindings(base, verifyFindings((await analyzeOnDevice(page)).findings, page, 'on_device'));
      else {
        const safe = { ...page, text: redact(page.text), checkboxes: page.checkboxes.map((c) => ({ ...c, label: redact(c.label) })) };
        found = mergeFindings(base, verifyFindings((await analyzeRedactedInCloud(safe)).findings, safe, 'in_cloud'));
      }
    } catch (e) {
      error = (e as Error).message;
    }
    rows.push({ id, ms: Math.round(performance.now() - t0), s: score(found, labels[id]), error, findings: found });
  }
  const result = { mode, when: new Date().toISOString(), summary: summarize(rows.filter((r) => !r.error).map((r) => r.s)), errors: rows.filter((r) => r.error).length, rows };
  (window as unknown as { evalResult: unknown }).evalResult = result;
  out.textContent = JSON.stringify(result, null, 2);
  status.textContent = `Done: ${mode}`;
}

for (const m of ['rules', 'device', 'cloud'] as Mode[]) document.getElementById(m)!.onclick = () => run(m);
