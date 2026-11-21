import type { PageSnapshot } from './types';

// Same logic the extension's content script uses, so the web app can snapshot
// the bundled demo store too.
export function snapshotDocument(doc: Document, url: string): PageSnapshot {
  const checkboxes = [...doc.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map((el) => {
    const label = (el.labels?.[0]?.innerText ?? el.closest('label')?.innerText ?? el.getAttribute('aria-label') ?? '').trim();
    return { label, checked: el.checked };
  }).filter((c) => c.label);
  const links = [...doc.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .map((a) => ({ text: a.innerText.trim(), href: a.href }))
    .filter((l) => /cancel|terms|subscription|renew|refund/i.test(l.text));
  return {
    url,
    title: doc.title,
    text: (doc.body?.innerText ?? '').slice(0, 20000),
    checkboxes,
    links,
    capturedAt: new Date().toISOString(),
  };
}
