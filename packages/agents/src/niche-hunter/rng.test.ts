import { describe, it, expect } from 'vitest';
import { seededRandom, sampleIndices } from './rng';

describe('seededRandom', () => {
  it('same seed -> identical sequence', () => {
    const a = seededRandom('run-123');
    const b = seededRandom('run-123');
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds -> different sequences (overwhelmingly likely)', () => {
    const a = seededRandom('run-123');
    const b = seededRandom('run-456');
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('yields floats in [0, 1)', () => {
    const rng = seededRandom('bounds-check');
    for (let i = 0; i < 200; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('accepts a numeric seed directly', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    expect(a()).toBe(b());
  });
});

describe('sampleIndices', () => {
  it('same seed -> same sampled indices', () => {
    const rngA = seededRandom('sample-seed');
    const rngB = seededRandom('sample-seed');
    const a = sampleIndices(100, 10, rngA);
    const b = sampleIndices(100, 10, rngB);
    expect(a).toEqual(b);
  });

  it('different seeds can produce different samples', () => {
    const rngA = seededRandom('seed-a');
    const rngB = seededRandom('seed-b');
    const a = sampleIndices(100, 10, rngA);
    const b = sampleIndices(100, 10, rngB);
    expect(a).not.toEqual(b);
  });

  it('returns exactly `count` distinct indices when n >= count', () => {
    const rng = seededRandom('distinct-check');
    const picked = sampleIndices(50, 12, rng);
    expect(picked).toHaveLength(12);
    expect(new Set(picked).size).toBe(12);
    for (const i of picked) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(50);
    }
  });

  it('clamps to n when count > n', () => {
    const rng = seededRandom('clamp-check');
    const picked = sampleIndices(3, 10, rng);
    expect(picked).toHaveLength(3);
    expect(new Set(picked)).toEqual(new Set([0, 1, 2]));
  });

  it('returns empty for n=0 or count=0', () => {
    const rng = seededRandom('empty-check');
    expect(sampleIndices(0, 5, rng)).toEqual([]);
    expect(sampleIndices(10, 0, rng)).toEqual([]);
  });
});
