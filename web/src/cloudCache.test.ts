import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cloudOnce, hashKey } from './cloudCache';
import { defaults } from './settings';

const s = { ...defaults, cloud_cooldown_seconds: 0 };

// The saved file is loaded once per page, like in the app, so stub it once
// with every entry the tests need.
const entries: Record<string, unknown> = {};
async function save(kind: string, text: string, value: unknown) {
  entries[await hashKey(kind, text, s)] = { kind, value, source: 'in_cloud', at: '2026-11-22T15:00:00.000Z' };
}
beforeAll(async () => {
  await save('terms', 'demo terms', { steps: ['saved'] });
  await save('redacted', 'demo page', [{ kind: 'fee' }]);
  await save('redacted', 'other page', [{ kind: 'fee' }]);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ entries }) })));
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => localStorage.clear());

describe('saved demo answers', () => {
  it('shows the saved real read first, then a fresh read on the next press', async () => {
    const run = vi.fn(async () => ({ value: { steps: ['fresh'] }, source: 'in_cloud' }));
    const first = await cloudOnce('terms', 'demo terms', s, run, () => {}, true);
    expect(first.cached).toBe('saved');
    expect(run).not.toHaveBeenCalled();
    const second = await cloudOnce('terms', 'demo terms', s, run, () => {}, true);
    expect(second.value).toEqual({ steps: ['fresh'] });
  });

  it('falls back to the saved read when a fresh read is blocked, and says why', async () => {
    const blocked = vi.fn(async () => { throw new Error('AI: Firebase App Check token is invalid. [403 ]'); });
    await cloudOnce('redacted', 'demo page', s, async () => ({ value: [], source: 'in_cloud' }), () => {}, true); // saved one
    localStorage.clear();
    const r = await cloudOnce('redacted', 'demo page', s, blocked, () => {}, true);
    expect(r.cached).toBe('saved');
    expect(r.value).toEqual([{ kind: 'fee' }]);
    expect(r.freshError).toMatch(/App Check/);
  });

  it('never falls back on pages that are not our demo, and never after Stop', async () => {
    const fail = async () => { throw new Error('403'); };
    await expect(cloudOnce('redacted', 'other page', s, fail, () => {}, false)).rejects.toThrow('403');
    const stop = async () => { const e = new Error('stopped'); e.name = 'AbortError'; throw e; };
    await expect(cloudOnce('redacted', 'other page x', s, stop, () => {}, true)).rejects.toThrow('stopped');
  });
});
