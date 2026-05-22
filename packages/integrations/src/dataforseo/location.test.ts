import { describe, it, expect } from 'vitest';
import { usStateName, dfsLocationName } from './location';

describe('usStateName', () => {
  it('expands a 2-letter abbreviation to the full state name', () => {
    expect(usStateName('TX')).toBe('Texas');
    expect(usStateName('ca')).toBe('California');
  });

  it('passes through an already-full name or unknown value', () => {
    expect(usStateName('Texas')).toBe('Texas');
    expect(usStateName('Ontario')).toBe('Ontario');
  });
});

describe('dfsLocationName', () => {
  it('builds the DataForSEO-valid format: full state, no spaces after commas', () => {
    // "Austin, TX, United States" returns 40501; this form resolves to the Austin metro.
    expect(dfsLocationName('Austin', 'TX')).toBe('Austin,Texas,United States');
  });

  it('trims surrounding whitespace on city and state', () => {
    expect(dfsLocationName(' Austin ', ' TX ')).toBe('Austin,Texas,United States');
  });
});
