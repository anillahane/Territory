import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearWindowInterval, replaceWindowInterval } from './polling';

describe('polling utilities', () => {
  beforeEach(() => {
    vi.spyOn(window, 'setInterval').mockImplementation((_handler, _timeout) => 42 as unknown as number);
    vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces an existing interval before starting a new one', () => {
    const nextIntervalId = replaceWindowInterval(17, vi.fn(), 2000);

    expect(window.clearInterval).toHaveBeenCalledWith(17);
    expect(window.setInterval).toHaveBeenCalledTimes(1);
    expect(window.setInterval).toHaveBeenCalledWith(expect.any(Function), 2000);
    expect(nextIntervalId).toBe(42);
  });

  it('clears an active interval and resets the handle', () => {
    expect(clearWindowInterval(17)).toBeNull();
    expect(window.clearInterval).toHaveBeenCalledWith(17);
  });
});
