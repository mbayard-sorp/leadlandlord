import { describe, expect, it } from 'vitest';
import { normalizeCustomHost } from './customsites-sanity';

describe('normalizeCustomHost', () => {
  it('strips a trailing port', () => {
    expect(normalizeCustomHost('constructionadrservices.com:3001')).toBe('constructionadrservices.com');
  });

  it('strips a leading www.', () => {
    expect(normalizeCustomHost('www.constructionadrservices.com')).toBe('constructionadrservices.com');
  });

  it('strips both www and port together, lowercased', () => {
    expect(normalizeCustomHost('WWW.ConstructionADRServices.com:443')).toBe('constructionadrservices.com');
  });

  it('leaves a bare apex host untouched', () => {
    expect(normalizeCustomHost('constructionadrservices.com')).toBe('constructionadrservices.com');
  });
});
