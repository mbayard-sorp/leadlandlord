import { createHash } from 'node:crypto';

/**
 * Deterministic H1 headline template pool. Each template uses {service},
 * {city}, and optionally {trust_signal} as placeholders. Hash-pick by
 * siteId+niche so every site gets a consistent template that varies across
 * the portfolio — avoids every site having an identical H1 pattern.
 *
 * Niche categories mirror THEME_TO_OVERLAY in content-engine/index.ts:
 *   trades  — classic theme (roofing, plumbing, HVAC, electrical, gutter, etc.)
 *   modern  — modern theme (solar, EV, smart-home, etc.)
 *   premium — premium theme (landscape, remodel, pool, etc.)
 *   bright  — bright theme (cleaning, lawn, pest, dog walking, etc.)
 */

interface TemplateEntry {
  template: string;
  niches: Array<'trades' | 'modern' | 'premium' | 'bright' | 'all'>;
}

const POOL: TemplateEntry[] = [
  // all
  { template: '{city} {service}', niches: ['all'] },
  { template: '{service} in {city}', niches: ['all'] },
  { template: '{service} — {city}', niches: ['all'] },
  { template: '{city} {service} | {trust_signal}', niches: ['all'] },
  // trades
  { template: '{city} {service} Pros', niches: ['trades'] },
  { template: 'Reliable {service} in {city}', niches: ['trades'] },
  { template: '{service} Repair & Service · {city}', niches: ['trades'] },
  { template: 'Fast {service} in {city} — {trust_signal}', niches: ['trades'] },
  { template: '{city}\'s {service} Specialists', niches: ['trades'] },
  { template: 'Local {service} · {city} · {trust_signal}', niches: ['trades'] },
  // modern
  { template: '{city} {service} Installation', niches: ['modern'] },
  { template: 'Professional {service} in {city}', niches: ['modern'] },
  { template: '{service} for {city} Homes', niches: ['modern'] },
  { template: 'Certified {service} · {city}', niches: ['modern'] },
  // premium
  { template: 'Custom {service} in {city}', niches: ['premium'] },
  { template: '{city} {service} Design & Build', niches: ['premium'] },
  { template: 'Artisan {service} · {city}', niches: ['premium'] },
  { template: '{service} Experts in {city}', niches: ['premium'] },
  // bright
  { template: '{city} {service} Service', niches: ['bright'] },
  { template: 'Affordable {service} in {city}', niches: ['bright'] },
  { template: '{service} You Can Count On · {city}', niches: ['bright'] },
  { template: 'Friendly {service} in {city}', niches: ['bright'] },
];

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
 * Returns an H1 template string deterministically selected for the given
 * siteId + niche (theme key or raw niche string). Placeholders:
 *   {service}      — primary service name
 *   {city}         — target city
 *   {trust_signal} — one trust signal (optional in template; caller substitutes)
 *
 * Same siteId+niche always returns the same template; different siteIds
 * distribute across all pool variants for the niche.
 */
export function getHeadlineTemplate(siteId: string, niche: string): string {
  const nicheTag = THEME_TO_NICHE[niche] ?? null;
  const eligible = POOL.filter(
    (e) => e.niches.includes('all') || (nicheTag && e.niches.includes(nicheTag)),
  );
  if (eligible.length === 0) return '{city} {service}';
  const idx = hashPickIndex(`${siteId}:${niche}`, eligible.length);
  return eligible[idx]!.template;
}
