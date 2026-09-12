import { describe, expect, it } from 'vitest';
import { OwnedTerminals } from '../src/session/owned-terminals.js';
import { SerialExecutor } from '../src/session/serial-executor.js';

describe('SerialExecutor', () => {
  it('never overlaps two operations in MVP mode', async () => {
    const executor = new SerialExecutor();
    let active = 0;
    let maxActive = 0;
    await Promise.all([1, 2, 3].map(() => executor.run(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
    })));
    expect(maxActive).toBe(1);
  });

  it('continues after a rejected task', async () => {
    const executor = new SerialExecutor();
    try { await executor.run(async () => { throw new Error('boom'); }); } catch { /* expected */ }
    expect(await executor.run(async () => 42)).toBe(42);
  });
});

describe('OwnedTerminals', () => {
  it('tracks only terminals opened by this process', () => {
    const owned = new OwnedTerminals();
    expect(owned.isOwned('dev-1')).toBe(false);
    owned.markOpened('dev-1');
    expect(owned.isOwned('dev-1')).toBe(true);
    expect(owned.listOwned()).toEqual(['dev-1']);
    owned.markClosed('dev-1');
    expect(owned.isOwned('dev-1')).toBe(false);
  });
});
