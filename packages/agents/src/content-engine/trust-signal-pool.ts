import { createHash } from 'node:crypto';

/**
 * Deterministic trust-signal pool. Hash-pick by siteId so every site gets a
 * consistent subset that differs across the portfolio — reduces footprint
 * signal overlap that would flag bulk-generated sites in manual review.
 *
 * Niche tags: 'trades' | 'modern' | 'premium' | 'bright' | 'all'.
 * Signals tagged 'all' are valid for any niche; niche-tagged ones are filtered
 * to the requested niche only.
 */

interface PoolEntry {
  text: string;
  niches: Array<'trades' | 'modern' | 'premium' | 'bright' | 'all'>;
}

const POOL: PoolEntry[] = [
  // all-niche entries
  { text: 'Licensed & insured', niches: ['all'] },
  { text: 'Free estimates', niches: ['all'] },
  { text: 'Same-week service', niches: ['all'] },
  { text: 'We answer the phone', niches: ['all'] },
  { text: 'No surprise pricing', niches: ['all'] },
  { text: 'Local crew', niches: ['all'] },
  { text: 'Family owned', niches: ['all'] },
  { text: 'Bonded & insured', niches: ['all'] },
  { text: 'Free quote in 15 min', niches: ['all'] },
  { text: 'Satisfaction guaranteed', niches: ['all'] },
  // trades
  { text: 'Emergency service available', niches: ['trades'] },
  { text: 'Fully licensed contractors', niches: ['trades'] },
  { text: 'Clean job site, always', niches: ['trades'] },
  { text: 'Upfront written quotes', niches: ['trades'] },
  { text: 'Parts + labor guaranteed', niches: ['trades'] },
  // modern
  { text: 'Certified installers', niches: ['modern'] },
  { text: 'Manufacturer warranty honored', niches: ['modern'] },
  { text: 'Same-day assessment', niches: ['modern'] },
  { text: 'Permit-ready installs', niches: ['modern'] },
  { text: 'Energy-rebate paperwork handled', niches: ['modern'] },
  // premium
  { text: '3D design included', niches: ['premium'] },
  { text: 'Material samples on site visit', niches: ['premium'] },
  { text: 'Project manager assigned', niches: ['premium'] },
  { text: 'Written scope + timeline', niches: ['premium'] },
  { text: '2-year workmanship warranty', niches: ['premium'] },
  // bright
  { text: 'Eco-friendly products', niches: ['bright'] },
  { text: 'Background-checked staff', niches: ['bright'] },
  { text: 'Easy online booking', niches: ['bright'] },
  { text: 'Reschedule anytime', niches: ['bright'] },
];

/**
 * Maps theme key to niche tag for filtering. Falls back to 'all' so signals
 * tagged 'all' are always available regardless of unknown theme.
 */
const THEME_TO_NICHE: Record<string, 'trades' | 'modern' | 'premium' | 'bright'> = {
  classic: 'trades',
  modern: 'modern',
  premium: 'premium',
  bright: 'bright',
};

function hashPickIndex(seed: string, poolSize: number): number {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 8);
  return parseInt(hex, 16) % poolSize;
}

/**
 * Returns `count` distinct trust-signal strings deterministically selected for
 * the given siteId + niche. Niche is a theme key ('classic' | 'modern' |
 * 'premium' | 'bright') or a raw niche string — unknown values fall back to
 * 'all'-tagged signals only. Same siteId+niche always returns the same set.
 */
export function getTrustSignals(siteId: string, niche: string, count: number): string[] {
  const nicheTag = THEME_TO_NICHE[niche] ?? null;
  const eligible = POOL.filter(
    (e) => e.niches.includes('all') || (nicheTag && e.niches.includes(nicheTag)),
  );
  if (eligible.length === 0) return [];

  const result: string[] = [];
  const used = new Set<number>();
  const cap = Math.min(count, eligible.length);
  let attempt = 0;
  while (result.length < cap) {
    const idx = hashPickIndex(`${siteId}:${niche}:${attempt}`, eligible.length);
    if (!used.has(idx)) {
      used.add(idx);
      result.push(eligible[idx]!.text);
    }
    attempt++;
    // Safety: avoid infinite loop when count > pool size
    if (attempt > eligible.length * 3) break;
  }
  return result;
}
