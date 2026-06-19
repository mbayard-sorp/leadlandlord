/**
 * variety-pools.ts
 *
 * Deterministic variety pools for spec-site-builder. Headline patterns,
 * CTA labels, and Imagen prompt seeds are drawn by index so adjacent
 * (trade, city) builds cycle through meaningfully different copy rather
 * than landing on the same template.
 *
 * Pool index is seeded by the count of existing buildsell_sites in the
 * same (trade, city) — see index.ts pick() helper.
 */

/** Hero headline patterns. {trade} and {city} are interpolated by the model via system.md. */
export const HEADLINE_PATTERNS = [
  'The {city} {trade} Pros Neighbors Trust',
  "{city}'s Go-To {trade} Team",
  'Fast, Reliable {trade} Service in {city}',
  'Quality {trade} Work — Guaranteed',
  "{city}'s Trusted {trade} Experts",
  'Honest {trade} Service, Done Right',
  'Your Local {trade} Specialists',
  '{trade} You Can Count On in {city}',
] as const;

/** Primary CTA label pool. */
export const PRIMARY_CTA_LABELS = [
  'Get a Free Quote',
  'Request a Free Estimate',
  'Schedule Your Free Consultation',
  'Get Your Free Estimate Today',
  'Claim Your Free Quote',
  'Book a Free Assessment',
  'Start With a Free Quote',
  'Get Pricing — It\'s Free',
] as const;

/** Secondary CTA label pool (used alongside phone CTA). */
export const SECONDARY_CTA_LABELS = [
  'Call Now',
  'Call Us Today',
  'Speak to a Pro',
  'Talk to Our Team',
  'Call for Details',
  'Reach Out Now',
  'Get in Touch',
  'Call for a Quote',
] as const;

/** Services section heading pool. */
export const SERVICES_HEADING_PATTERNS = [
  'What We Do',
  'Our Services',
  'How We Can Help',
  'Services We Offer',
  'What We Offer',
  'Our Work',
  'Our Capabilities',
  'We Handle It All',
] as const;

/** Services section subhead pool. */
export const SERVICES_SUBHEAD_PATTERNS = [
  'Quality work for every job, big or small.',
  'Trusted {trade} services for homeowners and businesses alike.',
  'From repairs to full installations — we do it all.',
  'Every job done right, on time, and within budget.',
  'Reliable results on every project.',
  'No job too big or too small.',
  'Built around your needs, your schedule, your budget.',
  'Expert solutions for every {trade} challenge.',
] as const;

/** Reviews section heading pool. */
export const REVIEWS_HEADING_PATTERNS = [
  'What Our Customers Say',
  'Hear From Our Clients',
  'Real Reviews From Real Customers',
  'Words From Our Neighbors',
  'Our Customers Speak',
  'In Their Own Words',
  'Trusted by Homeowners Like You',
  'Customer Stories',
] as const;

/**
 * Imagen prompt openers — varied per site so hero images are visually
 * distinct across the portfolio for the same trade.
 */
export const IMAGEN_HERO_OPENERS = [
  'Professional crew at work',
  'Skilled technician on the job',
  'Expert team completing a project',
  'Clean modern workspace',
  'Two professionals reviewing work',
  'Technician using professional tools',
  'Team arriving at a residential property',
  'Professional finishing a high-quality installation',
] as const;

/** Layout variants in rotation order. */
export const LAYOUT_VARIANTS = ['split', 'bold', 'trust'] as const;
export type LayoutVariant = (typeof LAYOUT_VARIANTS)[number];

/**
 * Theme preset pool. Ordered so adjacent (trade, city) builds rotate through
 * visually distinct palettes. Do NOT reorder — rotation relies on index stability.
 */
export const PRESET_ROTATION = [
  'Aqua Slate',
  'Forest Green',
  'Midnight Bold',
  'Warm Amber',
  'Sky Blue',
  'Deep Navy',
  'Slate Gray',
  'Rustic Red',
  'Cool Teal',
  'Charcoal Pro',
  'Sage Modern',
  'Cobalt Trust',
] as const;

/** Font heading pool — all loaded via next/font in site-host. */
export const FONT_HEADING_POOL = [
  'Poppins',
  'Space Grotesk',
  'Plus Jakarta Sans',
  'Sora',
  'Fraunces',
  'Manrope',
] as const;

/** Font body pool — paired with heading fonts. */
export const FONT_BODY_POOL = [
  'Inter',
  'Plus Jakarta Sans',
  'Manrope',
  'Space Grotesk',
  'Inter',
  'Inter',
] as const;

/**
 * Pick an element from a pool by index mod length.
 * Used by index.ts with the portfolio-position seed.
 */
export function pick<T>(pool: readonly T[], seed: number): T {
  const idx = ((seed % pool.length) + pool.length) % pool.length;
  return pool[idx] as T;
}

/**
 * Derive a rotation seed from the count of existing buildsell_sites for the
 * same (trade, city). This ensures the FIRST site in a market gets index 0,
 * the SECOND gets index 1, etc., so they cycle through variants deterministically.
 */
export function rotationSeed(existingCount: number): number {
  return existingCount;
}
