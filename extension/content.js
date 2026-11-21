// Injected only when the user opens the side panel or presses Check (activeTab).
// Returns a snapshot of the visible page. It is handed to the on-device model.
(() => {
  const checkboxes = [...document.querySelectorAll('input[type=checkbox]')].map((el) => {
    const label = ((el.labels && el.labels[0] && el.labels[0].innerText) || (el.closest('label') && el.closest('label').innerText) || el.getAttribute('aria-label') || '').trim();
    return { label, checked: el.checked };
  }).filter((c) => c.label);
  const links = [...document.querySelectorAll('a[href]')]
    .map((a) => ({ text: a.innerText.trim(), href: a.href }))
    .filter((l) => /cancel|terms|subscription|renew|refund/i.test(l.text));
  return {
    url: location.href,
    title: document.title,
    text: (document.body.innerText || '').slice(0, 20000),
    checkboxes,
    links,
    capturedAt: new Date().toISOString(),
  };
})();
