import { describe, it, expect, vi } from 'vitest';
import { UpdatePolicy } from '../../src/updater.js';

describe('UpdatePolicy (no updates during a game)', () => {
  it('defers the update while a game is in progress and applies it once safe', () => {
    let safe = false;
    const activate = vi.fn();
    const p = new UpdatePolicy({ isSafe: () => safe, activate });
    p.onUpdateReady();
    expect(p.pending).toBe(true);
    expect(activate).not.toHaveBeenCalled();
    expect(p.tryApply()).toBe(false);
    expect(activate).not.toHaveBeenCalled();
    safe = true;
    expect(p.tryApply()).toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
    // not applied twice
    expect(p.tryApply()).toBe(false);
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it('applies immediately when an update arrives on a safe screen', () => {
    const activate = vi.fn();
    const p = new UpdatePolicy({ isSafe: () => true, activate });
    p.onUpdateReady();
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it('does nothing without a pending update', () => {
    const activate = vi.fn();
    const p = new UpdatePolicy({ isSafe: () => true, activate });
    expect(p.tryApply()).toBe(false);
    expect(activate).not.toHaveBeenCalled();
  });
  it('force applies (user pressed retry on the game over screen)', () => {
    const activate = vi.fn();
    const p = new UpdatePolicy({ isSafe: () => false, activate });
    p.onUpdateReady();
    expect(p.tryApply(true)).toBe(true);
    expect(activate).toHaveBeenCalled();
  });
});
