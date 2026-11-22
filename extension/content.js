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
  return {
    url: here,
    title: document.title,
    text: (document.body.innerText || '').slice(0, 20000),
    checkboxes,
    links,
    capturedAt: new Date().toISOString(),
  };
})();
