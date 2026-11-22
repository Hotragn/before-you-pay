import { analyzeOnDevice, analyzeRedactedInCloud, cancelStepsInCloud, onDeviceAvailability, prepareOnDevice, useSettings } from './ai';
import { defaults, loadSettings, type Settings } from './settings';
import { mergeFindings } from './merge';
import { redact } from './redact';
import { ruleFindings } from './rules';
import { snapshotDocument } from './snapshot';
import { buildProof, listProofs, saveProof } from './store';
import { summaryLine } from './summary';
import type { Finding, PageSnapshot } from './types';
import { localDate, verifyFindings } from './verify';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// When the panel runs inside the extension side panel, the parent is our own
// extension page. Its ID is pinned by the "key" in manifest.json.
const EXTENSION_ORIGIN = 'chrome-extension://bpncchcdpggplmgfbpeloffjlkicjpjg';
const inExtension = window.parent !== window;
const toParent = (msg: object) => { if (inExtension) window.parent.postMessage(msg, EXTENSION_ORIGIN); };
const fromParent = (ev: MessageEvent) => inExtension && ev.source === window.parent && ev.origin === EXTENSION_ORIGIN;

let page: PageSnapshot | undefined;
let findings: Finding[] = [];
let settings: Settings = defaults;
let pendingRead = false;
loadSettings().then((s) => { settings = s; useSettings(s); });

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

function status(text: string) { $('status').textContent = text; }

function niceDate(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function title(f: Finding): string {
  if (f.kind === 'trial_conversion' && f.convertsOn) return `Becomes ${f.amount ?? 'paid'} on ${niceDate(f.convertsOn)}`;
  return f.amount ? `${LABELS[f.kind]}: ${f.amount}` : LABELS[f.kind];
}

function render() {
  const ol = $('cards');
  ol.innerHTML = '';
  for (const f of findings) {
    const li = document.createElement('li');
    li.className = `card ${f.verification}`;
    li.tabIndex = 0;
    li.innerHTML = `<div class="head"><span></span><span class="badge ${f.source}"></span></div><blockquote></blockquote>`;
    (li.querySelector('.head span') as HTMLElement).textContent = title(f);
    (li.querySelector('.badge') as HTMLElement).textContent = SOURCE[f.source];
    (li.querySelector('blockquote') as HTMLElement).textContent = f.reason ? `${f.quote} (${f.reason})` : f.quote;
    const go = () => toParent({ type: 'byp:highlight', quote: f.quote });
    li.onclick = go;
    li.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    ol.append(li);
  }
  const line = summaryLine(findings);
  $('summary').hidden = !line;
  $('summary').textContent = line;
  $('cancel').hidden = !page?.links.length;
  const hasTrial = findings.some((f) => f.kind === 'trial_conversion' && f.convertsOn && f.verification === 'verified');
  $('save').hidden = !findings.some((f) => f.verification === 'verified' && f.kind !== 'cancel_path');
  $('remind').textContent = hasTrial ? 'Remind me before the first charge and save what it said' : 'Save what this page said';
}

function load(snapshot: PageSnapshot) {
  page = snapshot;
  $('site').textContent = new URL(snapshot.url).hostname || snapshot.title;
  findings = mergeFindings(verifyFindings(ruleFindings(snapshot), snapshot, 'rules'));
  $('cancelOut').textContent = '';
  $('consent').hidden = true;
  render();
  if (pendingRead) { pendingRead = false; readOnDevice(); }
  else status('Basic check done. Press the button for a full read on your device.');
}

async function check() {
  // Start the model on the click itself: Chrome only allows the download to
  // begin right after a user gesture.
  const ready = settings.on_device_enabled
    ? prepareOnDevice((p) => status(`Downloading the on-device model: ${Math.round(p * 100)}%`))
    : Promise.resolve(false);
  modelReady = ready;
  if (inExtension) {
    // Always read the page again, so we never analyze a page you already left.
    pendingRead = true;
    status('Reading the page...');
    toParent({ type: 'byp:requestSnapshot' });
  } else if (page) {
    readOnDevice();
  } else {
    status('Open the demo store first, or install the extension to check real pages.');
  }
}
let modelReady: Promise<boolean> = Promise.resolve(false);

async function readOnDevice() {
  if (!page) return;
  status('Getting the on-device model ready...');
  if (!(await modelReady)) {
    if (!settings.on_device_enabled) {
      $('consentText').textContent = 'On-device reading is switched off for now. Your page has not left this computer.';
    } else {
      const a = await onDeviceAvailability();
      $('consentText').textContent = a === 'no-api'
        ? 'This browser has no on-device model (it needs Chrome on a desktop computer). Your page has not left this computer.'
        : 'This computer has no on-device model ready. Your page has not left this computer.';
    }
    $('consent').hidden = false;
    status('');
    return;
  }
  status('Reading on your device...');
  try {
    const t0 = performance.now();
    const { findings: raw, source } = await analyzeOnDevice(page);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const where = source === 'in_cloud' ? 'in_cloud' : 'on_device';
    findings = mergeFindings(findings, verifyFindings(raw, page, where));
    status(where === 'on_device'
      ? `Read on this computer in ${secs} s. The page was not sent anywhere.`
      : `Read in the cloud in ${secs} s.`);
    render();
  } catch (e) {
    status(`The on-device read did not work: ${plain(e)}`);
  }
}

async function sendRedacted() {
  if (!page) return;
  $('consent').hidden = true;
  const safe: PageSnapshot = {
    ...page,
    title: redact(page.title),
    text: redact(page.text),
    checkboxes: page.checkboxes.map((c) => ({ ...c, label: redact(c.label) })),
  };
  status('Reading a redacted copy in the cloud...');
  try {
    const { findings: raw, source } = await analyzeRedactedInCloud(safe);
    findings = mergeFindings(findings, verifyFindings(raw, safe, source === 'on_device' ? 'on_device' : 'in_cloud'));
    status('Read a redacted copy in the cloud. Emails, card details, phone numbers and street addresses were removed first.');
    render();
  } catch (e) {
    status(`The cloud read did not work: ${plain(e)}`);
  }
}

function fetchTermsText(href: string): Promise<string> {
  if (!inExtension) {
    return fetch(href).then((r) => r.text()).then((html) => new DOMParser().parseFromString(html, 'text/html').body.innerText);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => { window.removeEventListener('message', onMsg); resolve(''); }, 10000);
    const onMsg = (ev: MessageEvent) => {
      if (fromParent(ev) && ev.data?.type === 'byp:terms' && ev.data.href === href) {
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(String(ev.data.text ?? ''));
      }
    };
    window.addEventListener('message', onMsg);
    toParent({ type: 'byp:fetchTerms', href });
  });
}

async function readTerms() {
  // Prefer a link about cancelling over a general terms link.
  const link = page?.links.find((l) => /cancel/i.test(l.text)) ?? page?.links[0];
  if (!link) return;
  const out = $('cancelOut');
  out.textContent = `Fetching ${link.href}`;
  const text = redact((await fetchTermsText(link.href)).trim());
  if (text.length < 200) {
    out.textContent = 'Could not load the terms page from here, so nothing was sent to the cloud. Open the link to read it yourself.';
    return;
  }
  out.textContent = `Gemini is reading ${new URL(link.href).pathname} (public page, nothing about you is sent)...`;
  try {
    const { data, source } = await cancelStepsInCloud(text);
    out.innerHTML = '<span class="badge"></span><ol></ol><p class="muted"></p>';
    const badge = out.querySelector('.badge') as HTMLElement;
    badge.classList.add(source);
    badge.textContent = SOURCE[source] ?? source;
    for (const s of data.steps) { const li = document.createElement('li'); li.textContent = s; out.querySelector('ol')!.append(li); }
    out.querySelector('p')!.textContent = [data.noticeNeeded, data.refundPolicy].filter(Boolean).join(' ');
  } catch (e) {
    out.textContent = `Could not read the terms: ${plain(e)}`;
  }
}

// Turn SDK errors into something a person can act on.
function plain(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (/\b429\b|quota/i.test(m)) return 'Gemini in the cloud is busy right now (this demo runs on a free quota). Try again in a minute.';
  if (/App ?Check|recaptcha/i.test(m)) return 'This page could not prove it is the real app (App Check). Reload and try again.';
  if (/Failed to fetch|NetworkError|offline/i.test(m)) return 'You seem to be offline.';
  return m.slice(0, 200);
}

async function remind() {
  if (!page) return;
  const trial = findings.find((f) => f.kind === 'trial_conversion' && f.convertsOn && f.verification === 'verified');
  let remindOn: string | undefined;
  if (trial?.convertsOn) {
    const d = new Date(trial.convertsOn + 'T12:00:00');
    d.setDate(d.getDate() - settings.reminder_days_before);
    remindOn = localDate(d);
  }
  const proof = await buildProof(page, findings, remindOn);
  const where = await saveProof(proof);
  toParent({ type: 'byp:reminder', remindOn, site: proof.site });
  await renderSaved();
  $('saved').textContent = `Saved ${proof.quotes.length} quotes ${where === 'firestore' ? 'to your account' : 'on this device'}. `
    + (remindOn ? `Reminder for ${niceDate(remindOn)}. ` : '') + `Fingerprint ${proof.sha256.slice(0, 12)}.`;
}

async function demo() {
  const frame = $('sandbox') as HTMLIFrameElement;
  frame.src = '/demo-store/index.html';
  await new Promise((r) => (frame.onload = r));
  load(snapshotDocument(frame.contentDocument!, new URL('/demo-store/index.html', location.href).href));
}

async function renderSaved() {
  const list = await listProofs();
  const ol = $('savedList');
  ol.innerHTML = '';
  $('savedWrap').hidden = !list.length;
  for (const p of list) {
    const li = document.createElement('li');
    li.className = 'card saved';
    const head = document.createElement('div');
    head.className = 'head';
    head.textContent = p.remindOn ? `${p.site}, reminder ${niceDate(p.remindOn)}` : p.site;
    li.append(head);
    for (const q of p.quotes) { const b = document.createElement('blockquote'); b.textContent = q.quote; li.append(b); }
    const meta = document.createElement('p');
    meta.className = 'muted small';
    meta.textContent = `What the page said on ${new Date(p.capturedAt).toLocaleString()}. Fingerprint ${p.sha256.slice(0, 12)}.`;
    li.append(meta);
    ol.append(li);
  }
}

window.addEventListener('message', (ev) => {
  if (!fromParent(ev)) return;
  if (ev.data?.type === 'byp:snapshot') load(ev.data.snapshot as PageSnapshot);
  if (ev.data?.type === 'byp:error') { pendingRead = false; status(String(ev.data.message)); }
});
$('check').onclick = check;
$('demo').onclick = demo;
$('sendRedacted').onclick = sendRedacted;
$('stayLocal').onclick = () => ($('consent').hidden = true);
$('readTerms').onclick = readTerms;
$('remind').onclick = remind;
renderSaved();
if (inExtension) $('demo').hidden = true;
