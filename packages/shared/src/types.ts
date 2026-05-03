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

export const ContentBundle = z.object({
  niche: z.string(),
  city: z.string(),
  state: z.string(),
  business_name: z.string(),
  home: Page,
  services: z.array(Page),
  service_areas: z.array(Page),
  about: Page,
  contact: Page,
  blog_posts: z.array(Page),
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
