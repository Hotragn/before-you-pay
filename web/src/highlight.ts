// Marks just the quoted words when they sit in one text node, otherwise the
// smallest element that contains them. Same logic as the extension's version.
export function markQuote(doc: Document, quote: string): boolean {
  doc.querySelectorAll('mark.byp-mark').forEach((m) => m.replaceWith(...m.childNodes));
  doc.querySelectorAll<HTMLElement>('.byp-mark').forEach((e) => { e.classList.remove('byp-mark'); e.style.outline = ''; e.style.background = ''; });
  const words = quote.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const full = new RegExp(words.join('\\s+'), 'i');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const m = full.exec(node.data);
    if (!m) continue;
    const range = doc.createRange();
    range.setStart(node, m.index);
    range.setEnd(node, m.index + m[0].length);
    const mark = doc.createElement('mark');
    mark.className = 'byp-mark';
    mark.style.cssText = 'background:#ffe066;outline:2px solid #e8a400;border-radius:3px;padding:0 2px';
    range.surroundContents(mark);
    mark.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    return true;
  }
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim();
  const q = norm(quote).slice(0, 60);
  let best: HTMLElement | null = null;
  const els = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  while (els.nextNode()) {
    const el = els.currentNode as HTMLElement;
    if (norm(el.innerText || el.textContent || '').includes(q)) best = el;
  }
  if (!best) return false;
  best.classList.add('byp-mark');
  best.style.outline = '3px solid #e8a400';
  best.style.background = '#fff3c4';
  best.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  return true;
}

