import { z } from 'zod';

export const NicheKey = z.object({
  niche: z.string().min(1),
  city: z.string().min(1),
  state: z.string().length(2).regex(/^[A-Z]{2}$/, 'state must be 2-letter uppercase abbreviation'),
});
export type NicheKey = z.infer<typeof NicheKey>;

export const PageKind = z.enum([
  'home',
  'service',
  'service_area',
  'about',
  'contact',
  'blog',
]);
export type PageKind = z.infer<typeof PageKind>;

export const Page = z.object({
  kind: PageKind,
  slug: z.string(),
  title: z.string(),
  meta_description: z.string().max(160),
  mdx: z.string(),
  schema_org_jsonld: z.unknown().optional(),
});
export type Page = z.infer<typeof Page>;

/**
 * Visual variants. Site Builder picks one based on niche category so a
 * portfolio of 100 sites doesn't all look identical.
 *
 *   classic  — trade-classic, navy + safety-orange, slab/condensed, big phone.
 *              For HVAC, plumbing, electrical, gutter, roofing, etc.
 *   modern   — clean modern, aqua accent, geometric hero, sans throughout.
 *              For solar, EV charging, smart-home, water heater, etc.
 *   premium  — editorial, cream + serif, full-bleed photo, "by appointment".
 *              For custom landscape, kitchen remodel, pool builders, etc.
 *   bright   — warm cream + coral, rounded, friendly, "book online".
 *              For cleaning, junk removal, pest, lawn care, dog walking, etc.
 */
export const VariantKind = z.enum(['classic', 'modern', 'premium', 'bright']);
export type VariantKind = z.infer<typeof VariantKind>;

export const ContentBundle = z.object({
  niche: z.string(),
  city: z.string(),
  state: z.string(),
  business_name: z.string(),
  variant: VariantKind.default('classic'),
  hero_image_prompt: z.string().optional(),
  hero_image_url: z.string().optional(),
  nearby_cities: z.array(z.string()).default([]),
  trust_signals: z.array(z.string()).default([]),
  home: Page,
  services: z.array(Page),
  service_areas: z.array(Page),
  about: Page,
  contact: Page,
  blog_posts: z.array(Page),
  /**
   * Agent-authored informational pages at /pages/[slug]. Long-form, evergreen,
   * targets long-tail informational queries for the niche × city. Not in the
   * visible nav — surfaced via in-page "Learn more" sections + sitemap.
   */
  info_pages: z.array(Page).default([]),
  generated_at: z.string(),
});
export type ContentBundle = z.infer<typeof ContentBundle>;

export const TrackingNumber = z.object({
  number: z.string(),
  provider: z.enum(['callrail', 'twilio', 'mock']),
  whisper: z.string().optional(),
  recording_enabled: z.boolean(),
});
export type TrackingNumber = z.infer<typeof TrackingNumber>;
