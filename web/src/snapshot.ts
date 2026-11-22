import type { PageSnapshot } from './types';

// Same logic as the extension's content script, so the web app can snapshot
// the bundled demo store too. Terms links are kept only when they look like a
// public legal page: http(s), not this page, and no query string.
// Which kinds of personal details the page asks for or shows. Only the kinds
// are kept (never the values), to explain why the page stays on the device.
export function personalDetails(doc: Document, text: string): string[] {
  const kinds = new Set<string>();
  for (const el of doc.querySelectorAll<HTMLInputElement>('input, select, textarea')) {
    if (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'submit') continue;
    const key = [el.type, el.name, el.id, el.autocomplete, el.getAttribute('aria-label'), el.placeholder, el.labels?.[0]?.innerText]
      .filter(Boolean).join(' ').toLowerCase();
    if (/e-?mail/.test(key)) kinds.add('email');
    if (/cc-|card|credit|cvc|cvv|expir/.test(key)) kinds.add('card');
    if (/\btel\b|phone|mobile/.test(key)) kinds.add('phone');
    if (/address|street|postal|zip|city/.test(key)) kinds.add('address');
    if (/\bname\b|given-name|family-name|first name|last name/.test(key)) kinds.add('name');
    if (el.type === 'password') kinds.add('password');
  }
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text)) kinds.add('email');
  if (/(?:ending in|•••+|\*{3,})\s*\d{4}\b/i.test(text)) kinds.add('card');
  return [...kinds];
}

export function snapshotDocument(doc: Document, url: string): PageSnapshot {
  const here = url.split('#')[0];
  const checkboxes = [...doc.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map((el) => {
    const label = (el.labels?.[0]?.innerText ?? el.closest('label')?.innerText ?? el.getAttribute('aria-label') ?? '').trim();
    return { label, checked: el.checked };
  }).filter((c) => c.label);
  const links = [...doc.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .map((a) => ({ text: a.innerText.trim(), href: new URL(a.getAttribute('href') ?? '', url).href }))
    .filter((l) => /cancel|terms|subscription|renew|refund/i.test(l.text))
    .filter((l) => {
      try {
        const u = new URL(l.href);
        return /^https?:$/.test(u.protocol) && !u.search && u.href.split('#')[0] !== here;
      } catch { return false; }
    });
  const text = keepEnds(doc.body?.innerText ?? '');
  return { url: here, title: doc.title, text, checkboxes, links, personal: personalDetails(doc, text), capturedAt: new Date().toISOString() };
}

// Very long pages keep their start and their end, because the fine print is
// usually at the bottom. The same cut is in extension/content.js.
export function keepEnds(text: string, max = 20000): string {
  if (text.length <= max) return text;
  const tail = Math.floor(max * 0.3);
  return `${text.slice(0, max - tail)}\n[...]\n${text.slice(-tail)}`;
}
