import { localDate, normalize } from './verify';
import { redact } from './redact';

// Joins the two halves of the hybrid read, on this device: the trial end date
// and the prices come from the private checkout page, the notice period and
// refund rule come from the public terms page. The cloud never sees the
// checkout page, so it never learns when you will be charged or how much.

// from: 'gemini' when the line is a verified quote Gemini picked, 'basic' when
// it was found by pattern in the terms text. Set per fact.
export interface TermsFacts {
  notice?: { hours: number; quote: string; from: 'gemini' | 'basic' };
  noRefund?: { quote: string; from: 'gemini' | 'basic' };
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14, thirty: 30 };
const N = '(\\d+|one|two|three|four|five|six|seven|ten|fourteen|thirty)\\s+(?:\\(\\d+\\)\\s+)?(business days?|days?|hours?)';
// "at least 24 hours before", "no later than 3 days prior to", or "30 days' notice".
const NOTICE = new RegExp(`(?:at least|no later than|no less than|a minimum of)\\s+${N}\\s+(?:before|prior to|in advance)|${N}['’]?s?\\s+(?:written\\s+|advance\\s+|prior\\s+)?notice`, 'i');
const NO_REFUND = /non-?refundable|no refunds?\b|not (?:be )?refund(?:ed|able)|do not (?:provide|offer|give) refunds/i;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 8 && s.length < 400);
}

function noticeIn(s: string): { hours: number; quote: string } | undefined {
  const m = s.match(NOTICE);
  if (!m) return undefined;
  const num = m[1] ?? m[3];
  const n = /^\d+$/.test(num) ? Number(num) : WORD_NUM[num.toLowerCase()];
  const unit = (m[2] ?? m[4]).toLowerCase();
  // Business days are counted as calendar days plus a margin, to stay safe.
  const hours = unit.startsWith('hour') ? n : unit.startsWith('business') ? Math.ceil(n * 7 / 5) * 24 : n * 24;
  return { hours, quote: s };
}

// Gemini's quotes count only if they are really on the terms page. If Gemini
// did not quote the notice or refund line, the terms text is searched in code.
export function termsFacts(termsText: string, geminiQuotes: string[]): TermsFacts {
  const page = normalize(termsText);
  const real = geminiQuotes.filter((q) => q.trim().length > 8 && page.includes(normalize(q)));
  const pick = (list: string[], from: 'gemini' | 'basic') => {
    const n = list.map(noticeIn).find(Boolean);
    const nr = list.find((s) => NO_REFUND.test(s));
    return { notice: n ? { ...n, from } : undefined, noRefund: nr ? { quote: nr, from } : undefined };
  };
  const g = pick(real, 'gemini');
  const b = pick(sentences(termsText), 'basic');
  return { notice: g.notice ?? b.notice, noRefund: g.noRefund ?? b.noRefund };
}

// The last day to cancel. The page never says what time the charge happens,
// so we keep one extra day of margin.
export function cancelBy(convertsOn: string, notice?: { hours: number }): string {
  const d = new Date(convertsOn + 'T12:00:00');
  const days = notice ? Math.ceil(notice.hours / 24) : 0;
  d.setDate(d.getDate() - days - 1);
  return localDate(d);
}

// A calendar file built in this browser. Nothing is sent anywhere.
export function icsFor(opts: { site: string; cancelBy: string; convertsOn: string; firstBill: string; quotes: string[]; now?: Date }): string {
  const ymd = (iso: string) => iso.replace(/-/g, '');
  const next = new Date(opts.cancelBy + 'T12:00:00');
  next.setDate(next.getDate() + 1);
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const desc = [
    `Your free trial on ${opts.site} turns paid on ${opts.convertsOn}. The first charge would be ${opts.firstBill}.`,
    'What the pages said:',
    ...opts.quotes.map((q) => `"${redact(q)}"`),
    'Made by Before You Pay, on your device.',
  ].join('\n');
  const fold = (line: string) => line.match(/.{1,73}/g)!.join('\r\n ');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Before You Pay//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${ymd(opts.cancelBy)}-${opts.site.replace(/[^\w.-]/g, '')}@before-you-pay`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(opts.cancelBy)}`,
    `DTEND;VALUE=DATE:${ymd(localDate(next))}`,
    fold(`SUMMARY:${esc(`Cancel ${opts.site} today to avoid ${opts.firstBill}`)}`),
    fold(`DESCRIPTION:${esc(desc)}`),
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT9H', fold(`DESCRIPTION:${esc(`Cancel ${opts.site} today`)}`), 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}
