import { describe, expect, it } from 'vitest';
import { pickThemeForNiche, NICHE_THEME_MAP } from './pick-theme';

describe('pickThemeForNiche', () => {
  it('maps foundation repair to classic', () => {
    expect(pickThemeForNiche('foundation repair')).toBe('classic');
  });

  it('maps solar install to modern', () => {
    expect(pickThemeForNiche('solar install')).toBe('modern');
  });

  it('maps custom landscape to premium', () => {
    expect(pickThemeForNiche('custom landscape')).toBe('premium');
  });

  it('maps house cleaning to bright', () => {
    expect(pickThemeForNiche('house cleaning')).toBe('bright');
  });

  it('is whitespace- and case-insensitive', () => {
    expect(pickThemeForNiche('  GUTTER CLEANING  ')).toBe('classic');
  });

  it('falls back to classic for unknown niches', () => {
    expect(pickThemeForNiche('unknown niche xyz')).toBe('classic');
  });

  it('falls back to classic for empty input', () => {
    expect(pickThemeForNiche('')).toBe('classic');
  });

  it('exposes the underlying map for inspection', () => {
    expect(NICHE_THEME_MAP['foundation repair']).toBe('classic');
    expect(NICHE_THEME_MAP['solar install']).toBe('modern');
  });
});
