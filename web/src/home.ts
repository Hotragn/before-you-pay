import { listProofs } from './store';

const ol = document.getElementById('proofs')!;
listProofs().then((all) => {
  if (!all.length) return;
  ol.innerHTML = '';
  for (const p of all) {
    const li = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = p.site;
    li.append(strong, ` saved ${p.capturedAt.slice(0, 10)}, reminder ${p.remindOn ?? 'not set'}`);
    for (const q of p.quotes) { const b = document.createElement('blockquote'); b.textContent = q.quote; li.append(b); }
    ol.append(li);
  }
});
