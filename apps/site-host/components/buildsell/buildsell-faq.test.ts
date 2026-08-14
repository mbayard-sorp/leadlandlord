import { describe, expect, it } from 'vitest';
import { isFaqItemOpen, resolveFaqDefaultOpen } from './buildsell-faq';

describe('resolveFaqDefaultOpen', () => {
  it('passes through the three known settings', () => {
    expect(resolveFaqDefaultOpen('first')).toBe('first');
    expect(resolveFaqDefaultOpen('all')).toBe('all');
    expect(resolveFaqDefaultOpen('none')).toBe('none');
  });

  it('falls back to "first" for docs written before the field existed', () => {
    expect(resolveFaqDefaultOpen(undefined)).toBe('first');
    expect(resolveFaqDefaultOpen(null)).toBe('first');
  });

  it('falls back to "first" for empty or unrecognised values', () => {
    expect(resolveFaqDefaultOpen('')).toBe('first');
    expect(resolveFaqDefaultOpen('expanded')).toBe('first');
    expect(resolveFaqDefaultOpen(true)).toBe('first');
  });
});

describe('isFaqItemOpen', () => {
  const states = (count: number, setting: 'first' | 'all' | 'none') =>
    Array.from({ length: count }, (_, i) => isFaqItemOpen(i, setting));

  it('"first" opens only the leading item', () => {
    expect(states(4, 'first')).toEqual([true, false, false, false]);
  });

  it('"all" opens every item', () => {
    expect(states(4, 'all')).toEqual([true, true, true, true]);
  });

  it('"none" leaves every item collapsed', () => {
    expect(states(4, 'none')).toEqual([false, false, false, false]);
  });

  it('handles a single-item FAQ under every setting', () => {
    expect(states(1, 'first')).toEqual([true]);
    expect(states(1, 'all')).toEqual([true]);
    expect(states(1, 'none')).toEqual([false]);
  });
});
