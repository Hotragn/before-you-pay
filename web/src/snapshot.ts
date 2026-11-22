import type { PageSnapshot } from './types';

// Same logic as the extension's content script, so the web app can snapshot
// the bundled demo store too. Terms links are kept only when they look like a
// public legal page: http(s), not this page, and no query string.
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
  return { url: here, title: doc.title, text: (doc.body?.innerText ?? '').slice(0, 20000), checkboxes, links, capturedAt: new Date().toISOString() };
}
