// Runs the basic check over the labeled pages and writes eval/results-rules.json.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { ruleFindings } from './rules';
import { verifyFindings } from './verify';
import { snapshotDocument } from './snapshot';
import { score, summarize, type Labels } from './evalScore';

const dir = resolve(__dirname, '../public/eval');
const labels = JSON.parse(readFileSync(resolve(dir, 'labels.json'), 'utf8')) as Record<string, Labels>;

describe('basic check on the labeled set', () => {
  it('scores every page', () => {
    const rows = Object.keys(labels).map((id) => {
      const dom = new JSDOM(readFileSync(resolve(dir, 'fixtures', id + '.html'), 'utf8'));
      Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
      const page = { ...snapshotDocument(dom.window.document, `https://${id}.demo.example/`), capturedAt: '2026-11-22T15:00:00.000Z' };
      const found = verifyFindings(ruleFindings(page), page, 'rules');
      return { id, s: score(found, labels[id]), found: found.map((f) => `${f.kind} ${f.amount ?? ''} | ${f.quote.slice(0, 70)}`) };
    });
    const summary = summarize(rows.map((r) => r.s));
    writeFileSync(resolve(__dirname, '../../eval/results-rules.json'), JSON.stringify({ mode: 'rules', summary, rows }, null, 2));
    console.log(JSON.stringify(summary));
    expect(rows.length).toBe(16);
  });
});
