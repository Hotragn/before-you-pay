// Used only when the user explicitly agrees to send the page to the cloud
// because no on-device model is available, and on quotes before they are saved.
// It removes emails, card numbers and endings, phone numbers and street
// addresses. It does NOT reliably remove names; the consent text says so.
const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[card number]'],
  [/(?:ending in|ending|•••+|\*{3,})\s*\d{4}\b/gi, '[card ending]'],
  // Phone numbers: 10+ digits with phone-style separators, not dates or prices.
  [/(?<![\d$€£.,-])(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, '[phone]'],
  [/\b\d{1,5}\s+[A-Z][\w]*(?:\s[A-Z][\w]*)*\s(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Lane|Ln|Dr|Drive|Way|Ct|Court)\b\.?/g, '[street address]'],
  // ZIP codes only right after a state code ("MI 48104"), so plain numbers survive.
  [/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/g, '$1 [zip]'],
];

export function redact(text: string): string {
  return PATTERNS.reduce((t, [re, label]) => t.replace(re, label), text);
}
