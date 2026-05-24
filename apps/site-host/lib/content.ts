import { z } from 'zod';

/**
 * Site-host renders a Bundle exactly like the legacy site-template did, but
 * the source is no longer a content.json on disk — it's a Sanity site doc
 * resolved per request and adapted via lib/theme-bundle.ts. This file keeps
 * the Bundle/Page/Variant shape + pure helpers (telHref) so the variant
 * components stay portable.
 */

export const ReviewSchema = z.object({
  author: z.string(),
  rating: z.number().int().min(1).max(5),
  text: z.string(),
  source: z.enum(['google', 'yelp', 'bbb', 'facebook', 'direct']),
  date: z.string(),
  verified: z.boolean().default(false),
});
export type Review = z.infer<typeof ReviewSchema>;

export const PageSchema = z.object({
  kind: z.string(),
  slug: z.string(),
  title: z.string(),
  meta_description: z.string(),
  mdx: z.string(),
  schema_org_jsonld: z.unknown().optional(),
  og_image_url: z.string().url().optional(),
  /**
   * Exact keyword phrase this page targets (from the assigned KeywordCluster).
   * Content Engine sets this when keyword clusters are passed in. Variants
   * render this as the on-page H1 verbatim — see `heroH1()`.
   */
  primary_keyword: z.string().optional(),
  /** FAQ Q&A pairs rendered on service / service-area pages (see shared Page.faqs). */
  faqs: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
});

export const VariantSchema = z.enum(['classic', 'modern', 'premium', 'bright', 'haul', 'counsel']);
export type Variant = z.infer<typeof VariantSchema>;

export const BundleSchema = z.object({
  niche: z.string(),
  city: z.string(),
  state: z.string(),
  business_name: z.string(),
  variant: VariantSchema.default('classic'),
  hero_image_prompt: z.string().optional(),
  hero_image_url: z.string().optional(),
  logo_url: z.string().optional(),
  favicon_url: z.string().optional(),
  nearby_cities: z.array(z.string()).default([]),
  trust_signals: z.array(z.string()).default([]),
  home: PageSchema,
  services: z.array(PageSchema),
  service_areas: z.array(PageSchema),
  about: PageSchema,
  contact: PageSchema,
  blog_posts: z.array(PageSchema),
  info_pages: z.array(PageSchema).default([]),
  generated_at: z.string(),
  // Trust-signal fields — all optional with safe defaults (ADR 0001 + 0003)
  reviews: z.array(ReviewSchema).default([]),
  aggregate_rating: z.object({
    rating_value: z.number(),
    review_count: z.number().int(),
    best_rating: z.number().default(5),
  }).optional(),
  license_number: z.string().optional(),
  insurance_carrier: z.string().optional(),
  years_in_business: z.number().int().optional(),
  certifications: z.array(z.object({
    name: z.string(),
    issuer: z.string().optional(),
    year: z.number().int().optional(),
  })).default([]),
  photo_gallery: z.array(z.object({
    url: z.string().url(),
    alt: z.string(),
    caption: z.string().optional(),
  })).default([]),
  guarantees: z.array(z.string()).default([]),
  response_time_promise: z.string().optional(),
  /** Neighborhood service-area list for thin-mode home pages. */
  neighborhoods: z.array(z.object({
    name: z.string(),
    googleMapsUrl: z.string().url(),
  })).default([]),
});

export type Bundle = z.infer<typeof BundleSchema>;
export type Page = z.infer<typeof PageSchema>;

/** Build a `tel:` href from the (possibly formatted) tracking number. */
export function telHref(number: string): string {
  return `tel:${number.replace(/[^+\d]/g, '')}`;
}

/**
 * The exact phrase variants render as the home-page H1.
 *
 * SEO-critical: must be the targeted keyword phrase verbatim so the strongest
 * on-page signal aligns with what density-lint already enforces for `title`.
 * Falls back to `niche in city, state` when no keyword cluster was assigned
 * (legacy bundles, or sites generated before the keyword-planner pipeline).
 */
export function heroH1(bundle: Bundle): string {
  const kw = bundle.home.primary_keyword?.trim();
  if (kw) return kw;
  return `${bundle.niche} in ${bundle.city}, ${bundle.state}`;
}

/**
 * Title-case a keyword phrase for display in variants whose H1 is not
 * CSS-uppercased. Lowercases articles/prepositions in the middle. Preserves
 * the trailing 2-letter state abbreviation in uppercase.
 */
export function titleCaseKeyword(phrase: string): string {
  const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);
  const words = phrase.trim().split(/\s+/);
  return words
    .map((w, i) => {
      if (/^[a-z]{2}$/.test(w) && i === words.length - 1) return w.toUpperCase();
      if (i > 0 && i < words.length - 1 && small.has(w.toLowerCase())) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * The exact phrase a non-home page renders as its on-page H1.
 *
 * Returns `page.primary_keyword` verbatim when present (set by Content Engine
 * from the assigned KeywordCluster). Falls back to `page.title` for legacy
 * bundles that pre-date keyword-planner. The `page.title` meta-title format
 * ("Roof Replacement Owensboro KY | Smith Roofing") is intentionally kept for
 * the HTML <title> / generateMetadata — only the visible H1 gets this value.
 */
export function pageH1(page: Page): string {
  return page.primary_keyword?.trim() || page.title;
}

/**
 * Format a phone number for human display. Handles US/Canada E.164
 * (`+17252403261`) and bare 10-digit (`7252403261`) inputs. Anything else
 * passes through unchanged so non-US numbers remain visible.
 *
 * Examples:
 *   formatPhone('+17252403261')   → '(725) 240-3261'
 *   formatPhone('17252403261')    → '(725) 240-3261'
 *   formatPhone('7252403261')     → '(725) 240-3261'
 *   formatPhone('+447911123456')  → '+447911123456' (passthrough)
 */
export function formatPhone(input: string | null | undefined): string {
  if (!input) return '';
  const digits = input.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return input;
}
