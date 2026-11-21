import { analyzeOnDevice, cancelStepsInCloud, models, prepareOnDevice } from './ai';
import { hasFirebaseConfig } from './firebase';
import { mergeFindings } from './merge';
import { redact } from './redact';
import { ruleFindings } from './rules';
import { snapshotDocument } from './snapshot';
import { buildProof, saveProof } from './store';
import type { Finding, PageSnapshot } from './types';
import { verifyFindings } from './verify';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const inExtension = window.parent !== window;

let page: PageSnapshot | undefined;
let findings: Finding[] = [];

const LABELS: Record<string, string> = {
  due_today: 'Due today',
  trial_conversion: 'Trial turns paid',
  recurring_charge: 'Recurring charge',
  auto_renew: 'Renews automatically',
  prechecked_addon: 'Add-on already ticked',
  fee: 'Extra fee',
  cancel_path: 'Cancel or terms link',
};
const SOURCE: Record<string, string> = { on_device: 'ON DEVICE', in_cloud: 'IN CLOUD', rules: 'BASIC CHECK' };

function title(f: Finding): string {
  if (f.kind === 'trial_conversion' && f.convertsOn) {
    const d = new Date(f.convertsOn + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `Becomes ${f.amount ?? 'paid'} on ${d}`;
  }
  return f.amount ? `${LABELS[f.kind]}: ${f.amount}` : LABELS[f.kind];
}

function render() {
  const ol = $('cards');
  ol.innerHTML = '';
  for (const f of findings) {
    const li = document.createElement('li');
    li.className = `card ${f.verification}`;
    li.innerHTML = `<div class="head"><span></span><span class="badge ${f.source}">${SOURCE[f.source]}</span></div><blockquote></blockquote>`;
    (li.querySelector('.head span') as HTMLElement).textContent = title(f);
    (li.querySelector('blockquote') as HTMLElement).textContent = f.reason ? `${f.quote} (${f.reason})` : f.quote;
    li.onclick = () => window.parent.postMessage({ type: 'byp:highlight', quote: f.quote }, '*');
    ol.append(li);
  }
  $('cancel').hidden = !page?.links.length;
  $('save').hidden = !findings.some((f) => f.kind === 'trial_conversion' && f.convertsOn);
}

function load(snapshot: PageSnapshot) {
  page = snapshot;
  $('site').textContent = new URL(snapshot.url).hostname || snapshot.title;
  findings = mergeFindings(verifyFindings(ruleFindings(snapshot), snapshot, 'rules'));
  $('status').textContent = 'Basic check done. Press the button for a full read on your device.';
  render();
}

async function checkOnDevice() {
  if (!page) {
    window.parent.postMessage({ type: 'byp:requestSnapshot' }, '*');
    $('status').textContent = 'Reading the page...';
    return;
  }
  if (!hasFirebaseConfig) {
    $('status').textContent = 'Firebase is not configured yet (see README). Showing the basic check only.';
    return;
  }
  $('status').textContent = 'Getting the on-device model ready...';
  const ready = await prepareOnDevice((p) => ($('status').textContent = `Downloading the on-device model: ${Math.round(p * 100)}%`));
  if (!ready) {
    $('consent').hidden = false;
    $('status').textContent = '';
    return;
  }
  $('status').textContent = 'Reading on your device...';
  try {
    const t0 = performance.now();
    const { findings: raw, source } = await analyzeOnDevice(page);
    const ms = Math.round(performance.now() - t0);
    findings = mergeFindings(findings, verifyFindings(raw, page, source === 'in_cloud' ? 'in_cloud' : 'on_device'));
    $('status').textContent = `Read on your device in ${(ms / 1000).toFixed(1)} s. Nothing left this computer.`;
    render();
  } catch (e) {
    $('status').textContent = `On-device read failed: ${(e as Error).message}`;
  }
}

async function sendRedacted() {
  if (!page) return;
  $('consent').hidden = true;
  const m = models();
  if (!m) return;
  const safe: PageSnapshot = { ...page, text: redact(page.text), checkboxes: page.checkboxes.map((c) => ({ ...c, label: redact(c.label) })) };
  // The redacted copy goes through the public (cloud) model with the same
  // findings instructions. Quotes are still checked against the real page.
  const { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } = await import('firebase/ai');
  const { getFirebaseApp } = await import('./firebase');
  const { findingsJsonSchema, pageToPrompt } = await import('./ai');
  const cloud = getGenerativeModel(getAI(getFirebaseApp()!, { backend: new GoogleAIBackend() }), {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: { model: 'gemini-3.5-flash-lite', generationConfig: { responseMimeType: 'application/json', responseJsonSchema: findingsJsonSchema } },
  });
  $('status').textContent = 'Reading a redacted copy in the cloud...';
  try {
    const r = await cloud.generateContent(
      'List money commitments on this checkout page. Quote the page word for word. Never calculate dates.\n\n' + pageToPrompt(safe),
    );
    const raw = JSON.parse(r.response.text()).findings ?? [];
    findings = mergeFindings(findings, verifyFindings(raw, page, 'in_cloud'));
    $('status').textContent = 'Read a redacted copy in the cloud.';
    render();
  } catch (e) {
    $('status').textContent = `Cloud read failed: ${(e as Error).message}`;
  }
}

async function readTerms() {
  const link = page?.links[0];
  if (!link) return;
  $('cancelOut').textContent = 'Fetching the terms page...';
  let text: string;
  if (inExtension) {
    text = await new Promise((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        if (ev.data?.type === 'byp:terms') { window.removeEventListener('message', onMsg); resolve(ev.data.text as string); }
      };
      window.addEventListener('message', onMsg);
      window.parent.postMessage({ type: 'byp:fetchTerms', href: link.href }, '*');
    });
  } else {
    const html = await (await fetch(link.href)).text();
    text = new DOMParser().parseFromString(html, 'text/html').body.innerText || html.replace(/<[^>]+>/g, ' ');
  }
  if (!hasFirebaseConfig) { $('cancelOut').textContent = 'Firebase is not configured yet (see README).'; return; }
  $('cancelOut').textContent = 'Gemini is reading the public terms...';
  try {
    const { data, source } = await cancelStepsInCloud(text);
    const out = $('cancelOut');
    out.innerHTML = `<span class="badge ${source}">${SOURCE[source] ?? source}</span><ol></ol><p class="muted"></p>`;
    for (const s of data.steps) { const li = document.createElement('li'); li.textContent = s; out.querySelector('ol')!.append(li); }
    out.querySelector('p')!.textContent = [data.noticeNeeded, data.refundPolicy].filter(Boolean).join(' ');
  } catch (e) {
    $('cancelOut').textContent = `Could not read the terms: ${(e as Error).message}`;
  }
}

async function remind() {
  if (!page) return;
  const trial = findings.find((f) => f.kind === 'trial_conversion' && f.convertsOn);
  let remindOn: string | undefined;
  if (trial?.convertsOn) {
    const d = new Date(trial.convertsOn + 'T12:00:00');
    d.setDate(d.getDate() - 2);
    remindOn = d.toISOString().slice(0, 10);
  }
  const proof = await buildProof(page, findings, remindOn);
  const where = await saveProof(proof);
  window.parent.postMessage({ type: 'byp:reminder', remindOn, site: proof.site }, '*');
  $('saved').textContent = `Saved ${proof.quotes.length} quotes ${where === 'firestore' ? 'to your account' : 'on this device'}. Reminder set for ${remindOn}. Fingerprint ${proof.sha256.slice(0, 12)}.`;
}

async function demo() {
  const frame = $('sandbox') as HTMLIFrameElement;
  frame.src = '/demo-store/index.html';
  frame.hidden = false;
  frame.style.cssText = 'position:absolute;left:-9999px;width:800px;height:1200px';
  await new Promise((r) => (frame.onload = r));
  load(snapshotDocument(frame.contentDocument!, new URL('/demo-store/index.html', location.href).href));
}

window.addEventListener('message', (ev) => {
  if (ev.source === window.parent && ev.data?.type === 'byp:snapshot') load(ev.data.snapshot as PageSnapshot);
});
$('check').onclick = checkOnDevice;
$('demo').onclick = demo;
$('sendRedacted').onclick = sendRedacted;
$('stayLocal').onclick = () => ($('consent').hidden = true);
$('readTerms').onclick = readTerms;
$('remind').onclick = remind;
if (inExtension) { $('demo').hidden = true; window.parent.postMessage({ type: 'byp:ready' }, '*'); }
