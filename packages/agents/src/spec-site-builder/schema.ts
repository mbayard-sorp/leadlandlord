import { z } from 'zod';

/**
 * spec-site-builder input — the dispatch payload from the operator's
 * `buildsell.build` event. `buildsell_site_id` + `build_epoch` form the
 * dedupe key.
 */
export const SpecSiteBuilderInput = z.object({
  buildsell_site_id: z.string().uuid(),
  build_epoch: z.string(),
  /** Cached NAP — transient; never written to Postgres. Carried from Places cache via event payload. */
  phone: z.string().optional(),
  /** Full display-line address (e.g. "2240 S Archibald Ave, Ontario, CA"). No parsing. */
  address_line: z.string().optional(),
  /**
   * Operator correction fed via a `buildsell.revise` event. Injected into the
   * content prompt as a subordinate refinement hint (system.md ToS rules still
   * win). Bounded so it can't smuggle a large adversarial payload.
   */
  clarifying_prompt: z.string().max(500).optional(),
  /**
   * When true, reuse the existing doc's theme (preset/colors/layout/fonts)
   * instead of re-rolling rotation — a copy-only revision keeps the design.
   */
  preserve_theme: z.boolean().optional(),
  /** Override the paid/live rebuild guard (operator confirmation). */
  force_rebuild: z.boolean().optional(),
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

const ServiceCard = z.object({
  icon: z.string().describe('lucide icon name'),
  title: z.string(),
  description: z.string(),
  link: z.string().optional().describe('Optional anchor href (e.g. #contact).'),
});

const FooterLink = z.object({ label: z.string(), href: z.string() });

const FooterColumn = z.object({
  heading: z.string(),
  links: z.array(FooterLink).min(1).max(6),
});

const SocialLink = z.object({
  platform: z.enum(['facebook', 'instagram', 'yelp', 'google', 'nextdoor', 'twitter', 'linkedin', 'youtube']),
  href: z.string(),
});

const FormLabels = z.object({
  name: z.string().default('Your Name'),
  phone: z.string().default('Phone Number'),
  message: z.string().default('How can we help?'),
  submit: z.string().default('Send My Request'),
});

export const SpecSiteContent = z.object({
  seo: z.object({
    metaTitle: z.string(),
    metaDescription: z.string(),
    ogImagePrompt: z.string().optional().describe('Scene description for the OG share image (1:1, no text).'),
  }),
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
    imagePrompt: z.string().describe('AI hero image prompt — photographic scene only, no text or logos in image.'),
  }),
  /**
   * Services section — object with heading, optional subhead, and 4-6 cards.
   * heading/subhead are written directly to bsServicesSection so the GROQ
   * ..., spread picks them up without a projection change.
   */
  services: z.object({
    heading: z.string().describe('Section heading (e.g. "What We Do"). REQUIRED — no hardcoded fallback.'),
    subhead: z.string().optional(),
    cards: z.array(ServiceCard).min(4).max(6),
  }),
  about: z.object({
    heading: z.string(),
    body: z.string(),
    stats: z.array(z.object({ value: z.string(), label: z.string() })).min(2).max(4),
    imagePrompt: z.string().optional().describe('Scene description for the about/team image (4:3, no text).'),
  }),
  process: z.object({
    heading: z.string(),
    steps: z.array(z.object({ icon: z.string(), title: z.string(), description: z.string() })).min(3).max(4),
  }),
  /**
   * Reviews section — includes a section-level heading that maps to
   * bsReviewsSection.heading so the GROQ ..., spread picks it up.
   */
  reviews: z.object({
    heading: z.string().describe('Section heading (e.g. "What Our Customers Say"). REQUIRED — no hardcoded fallback.'),
    items: z
      .array(
        z.object({
          author: z.string().describe('First name + last initial (e.g. "Maria G.").'),
          initials: z.string().optional().describe('2-letter initials derived from author for avatar fallback (e.g. "MG").'),
          rating: z.number().min(1).max(5),
          text: z.string(),
          location: z.string().optional().describe('City or neighborhood (e.g. "Austin, TX"). Optional.'),
        }),
      )
      .min(3)
      .max(6)
      .describe('REPRESENTATIVE testimonials written from scratch — never verbatim Google review text.'),
  }),
  contact: z.object({
    heading: z.string(),
    subhead: z.string(),
    hours: z.string(),
    serviceArea: z.string(),
    formLabels: FormLabels.optional(),
  }),
  footer: z.object({
    tagline: z.string(),
    legal: z.string().describe('Copyright line — must include "© {year}" backfilled at runtime.'),
    columns: z.array(FooterColumn).min(0).max(3).optional(),
    social: z.array(SocialLink).min(0).max(5).optional(),
    legalLinks: z.array(FooterLink).min(0).max(4).optional().describe('Privacy policy, terms, etc. Optional.'),
  }),
});
export type SpecSiteContent = z.infer<typeof SpecSiteContent>;
