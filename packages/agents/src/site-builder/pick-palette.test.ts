import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pickPaletteForSite, type PaletteKey } from './pick-palette';

describe('pickPaletteForSite', () => {
  it('returns one of the three palette keys', () => {
    expect(['default', 'alt1', 'alt2']).toContain(
      pickPaletteForSite('11111111-1111-1111-1111-111111111111'),
    );
  });

  it('is deterministic — same id yields the same palette across calls', () => {
    const id = randomUUID();
    const first = pickPaletteForSite(id);
    for (let i = 0; i < 50; i++) {
      expect(pickPaletteForSite(id)).toBe(first);
    }
  });

  it('falls back to default for empty input', () => {
    expect(pickPaletteForSite('')).toBe('default');
  });

  it('spreads a sample of uuids across all three palettes', () => {
    const counts: Record<PaletteKey, number> = { default: 0, alt1: 0, alt2: 0 };
    const n = 3000;
    for (let i = 0; i < n; i++) {
      counts[pickPaletteForSite(randomUUID())]++;
    }
    // Every bucket should be hit, and none should dominate (allow generous
    // slack around the ideal 1/3 share).
    for (const key of ['default', 'alt1', 'alt2'] as PaletteKey[]) {
      expect(counts[key]).toBeGreaterThan(n * 0.25);
      expect(counts[key]).toBeLessThan(n * 0.42);
    }
  });
});
