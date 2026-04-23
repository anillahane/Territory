import { describe, expect, it } from 'vitest';
import { validateConfig } from '../configValidation';

const validConfig = {
  originLat: 8,
  originLon: 68,
  alphabet: '0123456789ABCDEFGHJKLMNPQRSTUV',
};

describe('validateConfig', () => {
  it('returns no errors for a valid configuration', () => {
    expect(validateConfig(validConfig)).toEqual({});
  });

  it('validates origin latitude and longitude ranges', () => {
    expect(validateConfig({
      ...validConfig,
      originLat: 120,
      originLon: -190,
    })).toEqual({
      originLat: 'Latitude must be between -90 and 90',
      originLon: 'Longitude must be between -180 and 180',
    });
  });

  it('requires exactly 30 unique alphabet characters', () => {
    expect(validateConfig({
      ...validConfig,
      alphabet: '0123456789ABCDEFGHJKLMNPQRSTU',
    })).toEqual({
      alphabet: 'Alphabet must contain exactly 30 characters',
    });

    expect(validateConfig({
      ...validConfig,
      alphabet: '0123456789ABCDEFGHJKLMNPQRSTUU',
    })).toEqual({
      alphabet: 'Alphabet must contain 30 unique characters',
    });
  });

  it('rejects hyphens in the alphabet', () => {
    expect(validateConfig({
      ...validConfig,
      alphabet: '0123456789ABCDEFGHJKLMNPQRSTU-',
    })).toEqual({
      alphabet: 'Alphabet cannot contain hyphen (-)',
    });
  });
});
