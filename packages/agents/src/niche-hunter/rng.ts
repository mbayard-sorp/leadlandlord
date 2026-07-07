/**
 * Deterministic seeded PRNG (mulberry32) + a Fisher-Yates-based sampler.
 *
 * No seeded-random utility existed anywhere in the codebase prior to Phase 5
 * (Niche Algorithm Accuracy plan) — this is a minimal, dependency-free
 * implementation so the scout's below-top-K sampling pass (scout.ts) is
 * reproducible in tests (same seed -> same sampled indices) without pulling
 * in a new package.
 */

/** Hash an arbitrary string seed to a 32-bit unsigned int (djb2 variant). */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: fast, small-state, good-enough-for-sampling PRNG. Returns a function yielding floats in [0, 1). */
export function seededRandom(seed: string | number): () => number {
  let a = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministically sample `count` distinct indices from [0, n) using the
 * given seeded RNG (partial Fisher-Yates). Returns fewer than `count` when
 * n < count. Order of the returned indices is the sampled order, not sorted.
 */
export function sampleIndices(n: number, count: number, rng: () => number): number[] {
  const target = Math.min(Math.max(0, count), Math.max(0, n));
  if (target === 0) return [];
  const pool = Array.from({ length: n }, (_, i) => i);
  const picked: number[] = [];
  let remaining = n;
  for (let i = 0; i < target; i++) {
    const j = Math.floor(rng() * remaining);
    picked.push(pool[j]!);
    pool[j] = pool[remaining - 1]!;
    remaining--;
  }
  return picked;
}
