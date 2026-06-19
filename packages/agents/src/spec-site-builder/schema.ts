import { z } from 'zod';

/**
 * spec-site-builder input — the dispatch payload from the operator's
 * `buildsell.build` event. `buildsell_site_id` + `build_epoch` form the
 * dedupe key.
 */
export const SpecSiteBuilderInput = z.object({
  buildsell_site_id: z.string().uuid(),
  build_epoch: z.string(),
});
export type SpecSiteBuilderInput = z.infer<typeof SpecSiteBuilderInput>;

export const SpecSiteBuilderOutput = z.object({
  buildsell_site_id: z.string(),
  doc_id: z.string(),
  slug: z.string(),
  sections: z.number(),
  hero_image: z.boolean(),
  cost_usd: z.number(),
});
export type SpecSiteBuilderOutput = z.infer<typeof SpecSiteBuilderOutput>;

// ── The structured content Claude returns via the submit tool ──────────────

const Cta = z.object({
  label: z.string(),
  href: z.string(),
  style: z.enum(['primary', 'secondary', 'ghost']).default('primary'),
});

const NavLink = z.object({ label: z.string(), href: z.string() });

export const SpecSiteContent = z.object({
  seo: z.object({ metaTitle: z.string(), metaDescription: z.string() }),
  navigation: z.array(NavLink).min(3).max(6),
  theme: z.object({
    preset: z.string(),
    layoutVariant: z.enum(['split', 'bold', 'trust']),
    primary: z.string(),
    primaryDark: z.string(),
    accent: z.string(),
    onPrimary: z.string(),
    bg: z.string(),
    surface: z.string(),
    text: z.string(),
    muted: z.string(),
    fontHeading: z.string(),
    fontBody: z.string(),
  }),
  hero: z.object({
    eyebrow: z.string(),
    headline: z.string(),
    highlight: z.string().optional(),
    subhead: z.string(),
    badges: z.array(z.object({ icon: z.string(), label: z.string() })).min(3).max(4),
    primaryCta: Cta,
    secondaryCta: Cta,
    imagePrompt: z.string().describe('AI hero image prompt — scene only, no text in image.'),
  }),
  services: z.array(z.object({ icon: z.string(), title: z.string(), description: z.string() })).min(4).max(6),
  about: z.object({
    heading: z.string(),
    body: z.string(),
    stats: z.array(z.object({ value: z.string(), label: z.string() })).min(2).max(4),
  }),
  process: z.object({
    heading: z.string(),
    steps: z.array(z.object({ icon: z.string(), title: z.string(), description: z.string() })).min(3).max(4),
  }),
  reviews: z
    .array(z.object({ author: z.string(), rating: z.number().min(1).max(5), text: z.string() }))
    .min(3)
    .max(6)
    .describe('REPRESENTATIVE testimonials written from scratch — never verbatim Google review text.'),
  contact: z.object({
    heading: z.string(),
    subhead: z.string(),
    hours: z.string(),
    serviceArea: z.string(),
  }),
  footer: z.object({ tagline: z.string(), legal: z.string() }),
});
export type SpecSiteContent = z.infer<typeof SpecSiteContent>;
