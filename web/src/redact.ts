// Used only when the user explicitly agrees to send the page to the cloud
// because no on-device model is available. Strips the obvious personal data
// first. This is a safety net, not the main privacy design: the main design is
// that the checkout page goes to the on-device model only.
const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[card number]'],
  [/(?:ending in|ending|•••+|\*{3,})\s*\d{4}/gi, '[card ending]'],
  [/\+?\d[\d\s().-]{8,}\d/g, '[phone]'],
  [/\b\d{1,5}\s+\w+(?:\s\w+)*\s(?:st|street|ave|avenue|rd|road|blvd|lane|ln|dr|drive|way|ct|court)\b\.?/gi, '[street address]'],
  [/\b\d{5}(?:-\d{4})?\b/g, '[zip]'],
];

export function redact(text: string): string {
  return PATTERNS.reduce((t, [re, label]) => t.replace(re, label), text);
}
