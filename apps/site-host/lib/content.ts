import { z } from 'zod';

/**
 * Site-host renders a Bundle exactly like the legacy site-template did, but
 * the source is no longer a content.json on disk — it's a Sanity site doc
 * resolved per request and adapted via lib/theme-bundle.ts. This file keeps
 * the Bundle/Page/Variant shape + pure helpers (telHref) so the variant
 * components stay portable.
 */

export const PageSchema = z.object({
  kind: z.string(),
  slug: z.string(),
  title: z.string(),
  meta_description: z.string(),
  mdx: z.string(),
  schema_org_jsonld: z.unknown().optional(),
});

export const VariantSchema = z.enum(['classic', 'modern', 'premium', 'bright']);
export type Variant = z.infer<typeof VariantSchema>;

export const BundleSchema = z.object({
  niche: z.string(),
  city: z.string(),
  state: z.string(),
  business_name: z.string(),
  variant: VariantSchema.default('classic'),
  hero_image_prompt: z.string().optional(),
  hero_image_url: z.string().optional(),
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
});

export type Bundle = z.infer<typeof BundleSchema>;
export type Page = z.infer<typeof PageSchema>;

/** Build a `tel:` href from the (possibly formatted) tracking number. */
export function telHref(number: string): string {
  return `tel:${number.replace(/[^+\d]/g, '')}`;
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
