import { describe, expect, it } from 'vitest';
import { parseCallerNameLookup } from './index';

describe('parseCallerNameLookup', () => {
  it('extracts a caller name from a valid v2 response', () => {
    expect(
      parseCallerNameLookup({
        caller_name: { caller_name: 'JOHN DOE', caller_type: 'CONSUMER', error_code: null },
      }),
    ).toBe('JOHN DOE');
  });

  it('trims whitespace', () => {
    expect(parseCallerNameLookup({ caller_name: { caller_name: '  ACME LLC  ' } })).toBe('ACME LLC');
  });

  it('returns null when the lookup carried an error code', () => {
    expect(
      parseCallerNameLookup({ caller_name: { caller_name: 'STALE', error_code: 60600 } }),
    ).toBeNull();
  });

  it('returns null for a blank or missing name', () => {
    expect(parseCallerNameLookup({ caller_name: { caller_name: '' } })).toBeNull();
    expect(parseCallerNameLookup({ caller_name: { caller_name: null } })).toBeNull();
    expect(parseCallerNameLookup({ caller_name: {} })).toBeNull();
  });

  it('returns null when the caller_name block is absent', () => {
    expect(parseCallerNameLookup({})).toBeNull();
    expect(parseCallerNameLookup({ caller_name: null })).toBeNull();
    expect(parseCallerNameLookup(null)).toBeNull();
    expect(parseCallerNameLookup(undefined)).toBeNull();
  });
});
