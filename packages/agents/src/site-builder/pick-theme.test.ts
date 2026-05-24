import { describe, expect, it } from 'vitest';
import { pickThemeForNiche, pickTheme, NICHE_THEME_MAP } from './pick-theme';

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

describe('pickTheme (category-aware)', () => {
  it('uses the legal category to pick counsel for an unmapped legal niche', () => {
    expect(pickTheme('medical malpractice lawyer', 'legal')).toBe('counsel');
  });

  it('prefers the specific niche map over the category fallback', () => {
    // junk removal is a haul niche even if mislabeled with a category
    expect(pickTheme('junk removal', 'legal')).toBe('haul');
  });

  it('matches a mapped legal niche without needing the category', () => {
    expect(pickTheme('divorce attorney')).toBe('counsel');
  });

  it('falls back to classic for an unknown niche with no category', () => {
    expect(pickTheme('unknown niche xyz')).toBe('classic');
  });

  it('falls back to classic for a category with no dedicated theme (medical)', () => {
    expect(pickTheme('pediatric dentist', 'medical')).toBe('classic');
  });

  it('ignores null/empty category', () => {
    expect(pickTheme('unknown niche xyz', null)).toBe('classic');
    expect(pickTheme('unknown niche xyz', '')).toBe('classic');
  });

  it('is whitespace- and case-insensitive on the category', () => {
    expect(pickTheme('some legal thing', '  LEGAL  ')).toBe('counsel');
  });
});
