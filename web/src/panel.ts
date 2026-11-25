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
import { firstYear, money, periodWords } from './cost';
import { cancelBy, icsFor, termsFacts, type TermsFacts } from './deadline';
import { ledger, markRedactions, record, watchRequests, type Entry } from './receipt';

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
let basicFindings: Finding[] = [];
let terms: { facts: TermsFacts; source: string } | undefined;
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
  renderCost();
  renderDeadline();
}

function load(snapshot: PageSnapshot) {
  page = snapshot;
  $('site').textContent = new URL(snapshot.url).hostname || snapshot.title;
  findings = mergeFindings(verifyFindings(ruleFindings(snapshot), snapshot, 'rules'));
  basicFindings = findings;
  terms = undefined;
  $('cancelOut').textContent = '';
  void record({ what: 'Checkout page, basic check (no model)', where: 'none', text: snapshot.text, requests: null, personal: snapshot.personal }).then(renderLedger);
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
    const current = page;
    const { value: read, requests } = await watchRequests(() => analyzeOnDevice(current, {
      signal,
      onPart: (i, n) => { if (n > 1) status(`Long page, reading it in ${n} parts on your device: part ${i}...`); },
    }));
    await record({ what: read.parts > 1 ? `Checkout page, ${read.parts} parts` : 'Checkout page', where: read.source === 'in_cloud' ? 'in_cloud' : 'on_device', text: read.prompts.join('\n\n'), requests, personal: current.personal });
    renderLedger();
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
    const sentText = pageToPrompt(safe, settings.max_page_chars * 2);
    const { value: r, requests } = await watchRequests(() => cloudOnce('redacted', sentText, settings, async () => {
      const { findings: value, source } = await analyzeRedactedInCloud(safe, signal);
      return { value, source };
    }, status, isOurDemo(page!.url)));
    await record({ what: 'Checkout page, redacted copy (you said yes)', where: 'in_cloud', text: sentText, requests, reused: Boolean(r.cached), personal: page.personal });
    renderLedger();
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
    const { value: r, requests } = await watchRequests(() => cloudOnce('terms', text, settings, async () => {
      const { data: value, source } = await cancelStepsInCloud(text, signal);
      return { value, source };
    }, (m) => (out.textContent = m), isOurDemo(link.href)));
    await record({ what: `Terms page (${new URL(link.href).pathname})`, where: 'in_cloud', text, requests, reused: Boolean(r.cached) });
    renderLedger();
    const { value: data, source } = r;
    terms = { facts: termsFacts(text, data.quotes ?? []), source };
    renderDeadline();
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
  if (r.freshError) return `A fresh cloud read did not work just now. ${plain(new Error(r.freshError))} Showing the saved answer from a real cloud read of this exact demo page on ${day} instead.`;
  return r.cached === 'saved'
    ? `This is the saved answer from a real cloud read of this exact demo page on ${day}, shown to save the free quota. Press again for a fresh read.`
    : `Same text as your last cloud read (${day}), so the earlier answer is shown. Press again for a fresh read.`;
}

// Turn SDK errors into something a person can act on.
function plain(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (/\b429\b|quota/i.test(m)) return 'Gemini in the cloud is busy right now (this demo runs on a free quota). Try again in a minute.';
  if (/App ?Check|recaptcha|\b40[13]\b/i.test(m)) return 'The cloud is protected by App Check, and it did not accept this browser (this can happen in automated or locked-down browsers). Try again later in a normal Chrome window.';
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
    const by = cancelBy(trial.convertsOn, terms?.facts.notice);
    remindOn = localDate(d) < by ? localDate(d) : by;
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
  // The demo store always reads as if it were opened on the day the video was
  // made, so the trial end, cancel-by date and first-year total match it.
  // Real pages (and the extension) always use today's date.
  load({ ...snapshotDocument(frame.contentDocument!, new URL('/demo-store/index.html', location.href).href), capturedAt: DEMO_DATE });
  $('demoNote').textContent = `Demo date fixed to ${new Date(DEMO_DATE).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} to match the video. Real pages use today's date.`;
  $('demoNote').hidden = false;
}
const DEMO_DATE = '2026-11-22T15:00:00.000Z';

const amountOf = (a?: string) => (a ? Number(a.replace(/[^\d.]/g, '')) : NaN);
const WHERE_WORDS: Record<string, string> = { on_device: 'read on this device', in_cloud: 'read in the cloud from a redacted copy', rules: 'found by the basic check on this device' };
const BADGE: Record<string, string> = { ...SOURCE, none: 'NO MODEL' };

function badgeEl(source: string): HTMLElement {
  const b = document.createElement('span');
  b.className = `badge ${source}`;
  b.textContent = BADGE[source] ?? source;
  return b;
}

// The first-year total, added up in code from verified findings (cost.ts).
function renderCost() {
  const fy = page ? firstYear(findings, page) : undefined;
  $('cost').hidden = !fy;
  if (!fy || !page) return;
  const v = findings.filter((f) => f.verification === 'verified');
  const due = v.find((f) => f.kind === 'due_today' && f.amount);
  const trial = v.find((f) => f.kind === 'trial_conversion' && f.convertsOn && !f.note);
  $('costToday').textContent = due ? money(amountOf(due.amount)) : 'not shown';
  $('costTotal').textContent = money(fy.total);
  $('costSub').textContent = [
    fy.plusTax ? 'Plus tax, which the page does not add up.' : '',
    trial?.convertsOn ? `First charge: ${money(fy.firstBill)} on ${niceDate(trial.convertsOn)}.` : '',
    'Every line comes from a quote on the page. Click one to see it.',
  ].filter(Boolean).join(' ');
  const ol = $('costLines');
  ol.innerHTML = '';
  for (const l of fy.lines) {
    const li = document.createElement('li');
    li.tabIndex = 0;
    const what = document.createElement('span'); what.className = 'what'; what.textContent = l.label;
    const sum = document.createElement('span'); sum.className = 'sum'; sum.textContent = money(l.subtotal);
    const how = document.createElement('span'); how.className = 'how';
    how.textContent = l.period === 'once' ? `${money(l.amount)} once ` : `${money(l.amount)} ${periodWords[l.period]} × ${l.count} `;
    how.append(badgeEl(l.source));
    li.append(what, sum, how);
    const go = () => (inExtension ? toParent({ type: 'byp:highlight', quote: l.quote }) : highlightInDemo(l.quote));
    li.onclick = go;
    li.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    ol.append(li);
  }
  const total = document.createElement('li'); total.className = 'total';
  total.innerHTML = '<span>First year</span><span class="sum"></span>';
  (total.querySelector('.sum') as HTMLElement).textContent = money(fy.total);
  ol.append(total);
  // How much the model's read added over plain pattern matching.
  const modelRead = v.some((f) => f.source !== 'rules');
  const basic = modelRead ? firstYear(basicFindings, page) : undefined;
  const more = basic ? Math.round((fy.total - basic.total) * 100) / 100 : 0;
  $('costGap').hidden = !(basic && more > 0);
  if (basic && more > 0) $('costGap').textContent = `The basic check alone adds up to ${money(basic.total)}. Reading the whole page found ${money(more)} more in the first year.`;
  $('costNot').hidden = !fy.notAdded.length;
  const ul = $('costNotList'); ul.innerHTML = '';
  for (const n of fy.notAdded) { const li = document.createElement('li'); li.textContent = `"${n.quote.slice(0, 120)}": ${n.why}.`; ul.append(li); }
}

function longDate(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// The cancel-by date joins the private page (trial end, prices) with the
// public terms (notice, refunds), here in the browser (deadline.ts).
function renderDeadline() {
  const trial = findings.find((f) => f.kind === 'trial_conversion' && f.convertsOn && f.verification === 'verified' && !f.note);
  $('deadline').hidden = !trial || !page;
  if (!trial?.convertsOn || !page) return;
  const fy = firstYear(findings, page);
  const bill = fy ? money(fy.firstBill) : (trial.amount ?? 'the full price');
  const notice = terms?.facts.notice;
  const by = cancelBy(trial.convertsOn, notice);
  $('dlDate').textContent = longDate(by);
  const parts = [`Cancel by then to avoid the first charge of ${bill} on ${niceDate(trial.convertsOn)}.`];
  if (!terms) parts.push('That is one day early, because the page does not say what time it charges. Read the cancellation terms below to check how much notice they need.');
  else {
    parts.push(notice
      ? `The terms ask for ${notice.hours % 24 === 0 && notice.hours >= 48 ? `${notice.hours / 24} days` : `${notice.hours} hours`} of notice, plus one day of margin because the page does not say what time it charges.`
      : 'The terms do not say how much notice they need, so this keeps one day of margin.');
    if (terms.facts.noRefund) parts.push('The terms also say payments are not refunded, so missing it costs the full amount.');
  }
  $('dlText').textContent = parts.join(' ');
  const qs = $('dlQuotes'); qs.innerHTML = '';
  const add = (quote: string, source: string) => {
    const b = document.createElement('blockquote');
    b.append(badgeEl(source), document.createTextNode(quote));
    qs.append(b);
  };
  add(trial.quote, trial.source);
  if (notice) add(notice.quote, notice.from === 'gemini' ? terms!.source : 'rules');
  if (terms?.facts.noRefund) add(terms.facts.noRefund.quote, terms.facts.noRefund.from === 'gemini' ? terms.source : 'rules');
  const privacy = trial.source === 'on_device'
    ? 'Put together here in your browser, so the cloud never saw what you picked or when you pay.'
    : trial.source === 'in_cloud'
      ? 'Put together here in your browser. A redacted copy of this page went to the cloud earlier because you said yes; with Gemini Nano it would not leave this device.'
      : 'Put together here in your browser.';
  $('dlHow').textContent = `Trial date and prices: from this page, ${WHERE_WORDS[trial.source]}. Notice and refunds: ${terms ? 'from the public terms page, read in the cloud' : 'not read yet'}. ${privacy}`;
}

function downloadIcs() {
  const trial = findings.find((f) => f.kind === 'trial_conversion' && f.convertsOn && f.verification === 'verified' && !f.note);
  if (!trial?.convertsOn || !page) return;
  const fy = firstYear(findings, page);
  const by = cancelBy(trial.convertsOn, terms?.facts.notice);
  const site = isOurDemo(page.url) ? 'Tunebox (demo store)' : (new URL(page.url).hostname || 'this site');
  const quotes = [trial.quote, terms?.facts.notice?.quote, terms?.facts.noRefund?.quote].filter(Boolean) as string[];
  const ics = icsFor({ site, cancelBy: by, convertsOn: trial.convertsOn, firstBill: fy ? money(fy.firstBill) : (trial.amount ?? ''), quotes });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = `cancel-by-${by}.ics`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  status(`Calendar file made in this browser: an all-day event on ${niceDate(by)} with the quotes in it. Nothing was sent anywhere.`);
}

function renderLedger() {
  const ol = $('ledger');
  ol.innerHTML = '';
  $('receipt').hidden = !ledger.length;
  for (const e of ledger.slice(0, 8)) ol.append(ledgerRow(e));
}

function ledgerRow(e: Entry): HTMLLIElement {
  const li = document.createElement('li');
  const row = document.createElement('div'); row.className = 'row';
  const what = document.createElement('span'); what.textContent = e.what;
  row.append(what, badgeEl(e.where));
  const meta = document.createElement('p'); meta.className = 'meta';
  meta.textContent = `${e.chars.toLocaleString()} characters · fingerprint ${e.sha256.slice(0, 10)} · ${e.at.toLocaleTimeString()}`;
  const line = document.createElement('p'); line.className = 'meta';
  if (e.where === 'none') line.textContent = 'Plain pattern matching in this page. No model, nothing sent.';
  else if (e.where === 'on_device') {
    const n = document.createElement('span'); n.className = e.requests === 0 ? 'zero' : '';
    n.textContent = e.requests === null ? 'Requests to Gemini could not be measured in this browser.' : `Requests to Gemini during this read: ${e.requests}.`;
    line.append(n, document.createTextNode(' The text was read by Gemini Nano here.'));
  } else {
    line.textContent = e.reused
      ? 'Answer reused from an earlier read of this exact text, so nothing was sent this time.'
      : `Requests to Gemini during this read: ${e.requests ?? 'not measured'}.`;
  }
  li.append(row, meta, line);
  if (e.where === 'in_cloud' && e.personal) {
    const p = document.createElement('p'); p.className = 'meta';
    p.textContent = 'What you typed into form fields is never read. Emails, card numbers, phone numbers and street addresses in the page text were replaced before sending (marked in red below). Names are not reliably removed.';
    li.append(p);
  } else if (e.personal?.length) {
    const p = document.createElement('p'); p.className = 'meta';
    p.textContent = `Stayed on this device: ${listWords(e.personal.map((k) => KIND_WORDS[k]).filter(Boolean))}.`;
    li.append(p);
  }
  if (e.sent) {
    const d = document.createElement('details');
    const sum = document.createElement('summary');
    const removed = (e.sent.match(/\[(?:email|card number|card ending|phone|street address|zip)\]/g) ?? []).length;
    sum.textContent = `Show the exact text ${e.reused ? 'sent earlier' : 'sent'}${removed ? ` (${removed} item${removed > 1 ? 's' : ''} removed, marked in red)` : ''}`;
    const pre = document.createElement('pre');
    for (const part of markRedactions(e.sent)) {
      if (part.removed) { const m = document.createElement('mark'); m.textContent = part.text; pre.append(m); }
      else pre.append(document.createTextNode(part.text));
    }
    const note = document.createElement('p'); note.className = 'meta';
    note.textContent = 'The app also sends its fixed instructions to the model. Nothing else from this page goes out.';
    // Open on the first removed item, so it is visible without scrolling.
    d.addEventListener('toggle', () => {
      const m = pre.querySelector('mark') as HTMLElement | null;
      if (d.open && m) pre.scrollTop = Math.max(0, m.offsetTop - 40);
    });
    d.append(sum, pre, note);
    li.append(d);
  }
  return li;
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
$('ics').onclick = downloadIcs;
renderSaved();
if (inExtension) $('demo').hidden = true;
