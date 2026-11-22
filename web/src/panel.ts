import { analyzeOnDevice, analyzeRedactedInCloud, cancelStepsInCloud, onDeviceAvailability, pageToPrompt, prepareOnDevice, useSettings } from './ai';
import { cloudOnce, type CloudResult } from './cloudCache';
import { defaults, loadSettings, type Settings } from './settings';
import { mergeFindings } from './merge';
import { redact, redactionCounts } from './redact';
import { ruleFindings } from './rules';
import { snapshotDocument } from './snapshot';
import { buildProof, listProofs, saveProof } from './store';
import { summaryLine } from './summary';
import type { Finding, PageSnapshot } from './types';
import { localDate, normalize, verifyFindings } from './verify';
import { markQuote } from './highlight';

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
loadSettings().then((s) => { settings = s; useSettings(s); }).finally(() => { showModelState(); showNet(); });

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

function status(text: string) {
  $('status').textContent = text;
  $('status').classList.toggle('busy', /\.\.\.$/.test(text));
}

// Show up front whether Gemini Nano can run here, and whether we are offline.
async function showModelState() {
  const a = settings.on_device_enabled ? await onDeviceAvailability() : 'unavailable';
  const chip = $('modelChip');
  const text: Record<string, string> = {
    available: 'Gemini Nano is ready on this computer',
    downloadable: 'Gemini Nano can be downloaded on first check',
    downloading: 'Gemini Nano is downloading',
    unavailable: 'No on-device model here, the basic check still works',
    'no-api': 'This browser has no on-device model',
  };
  chip.textContent = text[a] ?? a;
  chip.className = `chip ${a === 'available' || a === 'downloadable' || a === 'downloading' ? 'on' : 'off'}`;
}
function showNet() { $('netChip').hidden = navigator.onLine; }
window.addEventListener('online', showNet);
window.addEventListener('offline', showNet);

function niceDate(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function title(f: Finding): string {
  if (f.kind === 'trial_conversion' && f.convertsOn) return `Becomes ${f.amount ?? 'paid'} on ${niceDate(f.convertsOn)}`;
  const t = f.amount ? `${LABELS[f.kind]}: ${f.amount}` : LABELS[f.kind];
  return f.verification === 'verified' ? t : `Not confirmed: ${t}`;
}

function render() {
  const ol = $('cards');
  ol.innerHTML = '';
  for (const f of findings) {
    const li = document.createElement('li');
    li.className = `card ${f.verification}`;
    li.dataset.kind = f.kind;
    li.tabIndex = 0;
    li.innerHTML = `<div class="head"><span></span><span class="badge ${f.source}"></span></div><blockquote></blockquote>`;
    (li.querySelector('.head span') as HTMLElement).textContent = title(f);
    (li.querySelector('.badge') as HTMLElement).textContent = SOURCE[f.source];
    (li.querySelector('blockquote') as HTMLElement).textContent = f.reason ? `${f.quote} (${f.reason})` : f.quote;
    if (f.note) { const n = document.createElement('p'); n.className = 'note'; n.textContent = f.note; li.append(n); }
    const go = () => (inExtension ? toParent({ type: 'byp:highlight', quote: f.quote }) : highlightInDemo(f.quote));
    li.onclick = go;
    li.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    ol.append(li);
  }
  const line = summaryLine(findings);
  $('summaryWrap').hidden = !line;
  $('summary').textContent = line;
  $('intro').hidden = findings.length > 0;
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
    ? prepareOnDevice((p) => {
      const bar = $('download') as HTMLProgressElement;
      bar.hidden = p >= 1;
      bar.value = p;
      status(p >= 1 ? 'Model ready...' : `Downloading Gemini Nano to this computer: ${Math.round(p * 100)}%. This happens once...`);
    })
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
  route('device');
  status('Reading on your device...');
  const signal = startJob();
  try {
    const t0 = performance.now();
    const read = await analyzeOnDevice(page, {
      signal,
      onPart: (i, n) => { if (n > 1) status(`Long page, reading it in ${n} parts on your device: part ${i}...`); },
    });
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const where = read.source === 'in_cloud' ? 'in_cloud' : 'on_device';
    findings = mergeFindings(findings, verifyFindings(read.findings, page, where));
    const parts = read.parts > 1 ? ` in ${read.parts} parts` : '';
    const trimmed = read.trimmed ? ' The page was very long, so some of it was skipped.' : '';
    status(where === 'on_device'
      ? `Read on this computer in ${secs} s${parts}${navigator.onLine ? '' : ' with no internet connection'}. The page was not sent anywhere.${trimmed}`
      : `Read in the cloud in ${secs} s.`);
    render();
  } catch (e) {
    status(wasStopped(e) ? 'Stopped. The basic check results are still here.' : `The on-device read did not work: ${plain(e)}`);
  } finally {
    endJob();
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
  const counts = redactionCounts([page.title, page.text, ...page.checkboxes.map((c) => c.label)].join('\n'));
  route('redacted', Object.entries(counts).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', '));
  status('Reading a redacted copy in the cloud...');
  const signal = startJob();
  try {
    const r = await cloudOnce('redacted', pageToPrompt(safe, settings.max_page_chars * 2), settings, async () => {
      const { findings: value, source } = await analyzeRedactedInCloud(safe, signal);
      return { value, source };
    }, status, isOurDemo(page.url));
    findings = mergeFindings(findings, verifyFindings(r.value, safe, r.source === 'on_device' ? 'on_device' : 'in_cloud'));
    status(cachedNote(r) || 'Read a redacted copy in the cloud. Emails, card details, phone numbers and street addresses were removed first.');
    render();
  } catch (e) {
    status(wasStopped(e) ? 'Stopped.' : `The cloud read did not work: ${plain(e)}`);
  } finally {
    endJob();
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
  if (!navigator.onLine) {
    out.textContent = 'You are offline. The terms page needs the cloud, so this part waits until you are back online. The check above was done on this computer.';
    return;
  }
  out.textContent = `Fetching ${link.href}...`;
  const text = redact((await fetchTermsText(link.href).catch(() => '')).trim());
  if (text.length < 200) {
    out.textContent = 'Could not load the terms page from here, so nothing was sent to the cloud. Open the link to read it yourself.';
    return;
  }
  out.textContent = `Gemini is reading ${new URL(link.href).pathname} (public page, nothing about you is sent)...`;
  route('terms');
  const signal = startJob();
  try {
    const r = await cloudOnce('terms', text, settings, async () => {
      const { data: value, source } = await cancelStepsInCloud(text, signal);
      return { value, source };
    }, (m) => (out.textContent = m), isOurDemo(link.href));
    const { value: data, source } = r;
    const note = cachedNote(r);
    out.innerHTML = '<span class="badge"></span><ol></ol><p class="muted"></p>';
    const badge = out.querySelector('.badge') as HTMLElement;
    badge.classList.add(source);
    badge.textContent = SOURCE[source] ?? source;
    for (const s of data.steps) { const li = document.createElement('li'); li.textContent = s; out.querySelector('ol')!.append(li); }
    out.querySelector('p')!.textContent = [data.noticeNeeded, data.refundPolicy].filter(Boolean).join(' ');
    // The steps are only as good as the lines they came from, so show the
    // quoted lines that really are on the terms page, and say so if none are.
    const found = (data.quotes ?? []).filter((q) => q.trim().length > 8 && normalize(text).includes(normalize(q)));
    for (const q of found.slice(0, 4)) { const b = document.createElement('blockquote'); b.textContent = q; out.append(b); }
    if (!found.length) {
      const w = document.createElement('p'); w.className = 'note';
      w.textContent = 'Not confirmed: none of the lines Gemini quoted were found on the terms page. Read the page before relying on these steps.';
      out.append(w);
    }
    if (note) { const n = document.createElement('p'); n.className = 'muted small'; n.textContent = note; out.append(n); }
  } catch (e) {
    out.textContent = wasStopped(e) ? 'Stopped.' : `Could not read the terms: ${plain(e)}`;
  } finally {
    endJob();
  }
}

// One sentence, shown at the moment of each read, saying where the text is
// going and why.
const KIND_WORDS: Record<string, string> = { email: 'your email', card: 'card details', phone: 'a phone number', address: 'an address', name: 'your name', password: 'a password' };
function listWords(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}
function route(where: 'device' | 'cloud' | 'redacted' | 'terms', detail = '') {
  const el = $('route');
  el.hidden = false;
  el.className = `route-now ${where === 'device' ? 'on_device' : 'in_cloud'}`;
  const kinds = (page?.personal ?? []).map((k) => KIND_WORDS[k]).filter(Boolean);
  const text: Record<string, string> = {
    device: kinds.length
      ? `This page has ${listWords(kinds)}, so it stays on this device. Gemini Nano reads it here.`
      : 'No personal details spotted on this page, but checkout pages usually have them, so it still stays on this device.',
    redacted: detail
      ? `Sending a copy to Gemini in the cloud because you said yes. Removed first: ${detail}.`
      : 'Sending a copy to Gemini in the cloud because you said yes. What you typed into form fields is never read, and no emails, card numbers, phone numbers or addresses were found in the page text.',
    terms: 'This is the public terms page. It has nothing about you, so Gemini in the cloud reads it.',
    cloud: detail,
  };
  $('routeText').textContent = text[where];
}

// One job at a time can be stopped with the Stop button.
let job: AbortController | undefined;
function startJob(): AbortSignal {
  job?.abort();
  job = new AbortController();
  $('stop').hidden = false;
  return job.signal;
}
function endJob() { job = undefined; $('stop').hidden = true; }
const wasStopped = (e: unknown) => (e as Error)?.name === 'AbortError';

// On the hosted panel the demo store sits next to the cards, so clicking a
// card highlights the line right there, the same way the extension does on
// a real page.
function highlightInDemo(quote: string): boolean {
  const doc = ($('sandbox') as HTMLIFrameElement).contentDocument;
  return doc?.body ? markQuote(doc, quote) : false;
}

// Saved demo results are only used for our own demo store and its terms page.
function isOurDemo(url: string): boolean {
  try {
    const u = new URL(url);
    return u.origin === 'https://before-you-pay-9b8c6.web.app' && /^\/(demo-store\/|terms\.html)/.test(u.pathname);
  } catch { return false; }
}

function cachedNote(r: CloudResult<unknown>): string {
  if (!r.cached) return '';
  const day = r.savedAt ? new Date(r.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  return r.cached === 'saved'
    ? `This is the saved answer from a real cloud read of this exact demo page on ${day}, shown to save the free quota. Press again for a fresh read.`
    : `Same text as your last cloud read (${day}), so the earlier answer is shown. Press again for a fresh read.`;
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
  document.body.classList.add('demo-open');
  frame.removeAttribute('aria-hidden');
  frame.tabIndex = 0;
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
$('stop').onclick = () => job?.abort();
$('remind').onclick = remind;
renderSaved();
if (inExtension) $('demo').hidden = true;
