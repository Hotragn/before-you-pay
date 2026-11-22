// Injected only when the user presses Check (activeTab). Returns a snapshot of the
// visible page for the on-device model. Terms links are kept only when they look
// like a public legal page: http(s), not this page, and no query string (query
// strings often carry session or order tokens).
(() => {
  const here = location.href.split('#')[0];
  const checkboxes = [...document.querySelectorAll('input[type=checkbox]')].map((el) => {
    const label = ((el.labels && el.labels[0] && el.labels[0].innerText) || (el.closest('label') && el.closest('label').innerText) || el.getAttribute('aria-label') || '').trim();
    return { label, checked: el.checked };
  }).filter((c) => c.label);
  const links = [...document.querySelectorAll('a[href]')]
    .map((a) => ({ text: a.innerText.trim(), href: a.href }))
    .filter((l) => /cancel|terms|subscription|renew|refund/i.test(l.text))
    .filter((l) => {
      try {
        const u = new URL(l.href);
        return /^https?:$/.test(u.protocol) && !u.search && u.href.split('#')[0] !== here;
      } catch (e) { return false; }
    });
  // Same as personalDetails() in web/src/snapshot.ts: kinds only, never values.
  const text = (document.body.innerText || '').slice(0, 20000);
  const kinds = new Set();
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (['hidden', 'checkbox', 'radio', 'submit'].includes(el.type)) continue;
    const key = [el.type, el.name, el.id, el.autocomplete, el.getAttribute('aria-label'), el.placeholder, el.labels && el.labels[0] && el.labels[0].innerText]
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
  return {
    url: here,
    title: document.title,
    text,
    personal: [...kinds],
    checkboxes,
    links,
    capturedAt: new Date().toISOString(),
  };
})();
