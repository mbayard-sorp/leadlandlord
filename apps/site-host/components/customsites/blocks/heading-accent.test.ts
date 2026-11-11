import { describe, expect, it } from 'vitest';
import { splitHeadingAccent } from './heading-accent';

describe('splitHeadingAccent', () => {
  it('wraps the accent word and keeps the line break and period around it', () => {
    expect(splitHeadingAccent('Your lines,\nlit.', 'lit')).toEqual({
      before: 'Your lines,\n',
      accent: 'lit',
      after: '.',
    });
  });

  it('colors the last match, not a substring earlier in the heading', () => {
    expect(splitHeadingAccent('Lit lines, lit.', 'lit')?.before).toBe('Lit lines, ');
  });

  it('returns null with no accent, a blank accent, or no match', () => {
    expect(splitHeadingAccent('Your lines, lit.', null)).toBeNull();
    expect(splitHeadingAccent('Your lines, lit.', '  ')).toBeNull();
    expect(splitHeadingAccent('Look up.', 'lit')).toBeNull();
  });
});
