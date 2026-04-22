import { describe, expect, it } from 'vitest';
import { formatIndiaDateTime } from './datetime';

describe('formatIndiaDateTime', () => {
  it('formats timestamps in Asia/Kolkata using date-fns-tz', () => {
    expect(formatIndiaDateTime('2026-04-22T16:32:37.000Z')).toBe('22 Apr 2026 22:02:37');
  });

  it('returns a fallback label for invalid timestamps', () => {
    expect(formatIndiaDateTime('not-a-date')).toBe('Unknown timestamp');
    expect(formatIndiaDateTime(undefined)).toBe('Unknown timestamp');
  });
});
