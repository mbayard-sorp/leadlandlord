import { z } from 'zod';

export const SiteMode = z.enum(['thin', 'content_rich']);
export type SiteMode = z.infer<typeof SiteMode>;

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
  'info',
  'faq',
]);
export type PageKind = z.infer<typeof PageKind>;

/**
 * One keyword Content Engine declares the page targets. Stamped onto the
 * Sanity page doc by persist-sanity. Joined against GSC reality by Phase 4
 * SEO Operator.
 */
export const TargetedKeyword = z.object({
  phrase: z.string(),
  role: z.enum(['primary', 'secondary', 'supporting']),
  cluster_key: z.string().optional(),
});
export type TargetedKeyword = z.infer<typeof TargetedKeyword>;

export const Page = z.object({
  kind: PageKind,
  slug: z.string(),
  title: z.string(),
  meta_description: z.string().max(160),
  mdx: z.string(),
  schema_org_jsonld: z.unknown().optional(),
  /**
   * Primary image URL for this page, emitted as Article `image` on blog / info
   * pages (required for article rich-result eligibility). Generated per-page at
   * build time; falls back to the site hero image when absent.
   */
  article_image_url: z.string().optional(),
  /** Prompt used to generate `article_image_url`. */
  article_image_prompt: z.string().optional(),
  /**
   * Alt text for `article_image_url`. A literal description of the image
   * (not the page topic) for screen readers and image SEO — mention the
   * business/city naturally, no keyword stuffing, <=125 chars.
   */
  article_image_alt: z.string().max(125).optional(),
  /**
   * Last meaningful content update (ISO), emitted as Article `dateModified`.
   * Stamped by the pipeline on (re)generation; falls back to the bundle's
   * generated_at when absent.
   */
  date_modified: z.string().optional(),
  /**
   * Stable cluster identifier this page targets. Optional only because
   * legacy bundles (pre-keyword-planner) won't have it.
   */
  cluster_key: z.string().optional(),
  /** The cluster's primary_keyword. Must appear in title, h1, slug, meta. */
  primary_keyword: z.string().optional(),
  /** Each declared targeted keyword. Max 12 to keep tool output bounded. */
  targeted_keywords: z.array(TargetedKeyword).max(12).default([]),
  /**
   * FAQ Q&A pairs. Rendered as a visible FAQ section + FAQPage JSON-LD on
   * service and service-area pages — the surfaces LLM answer engines extract
   * "<service> <city>" answers from. MUST be locally specific (city, service,
   * business) and varied per site: identical Q&A across the network is both
   * duplicate content and a footprint signal. Empty for kinds that don't use it.
   * Kept lenient (no min lengths) so a weak answer never fails bundle parsing —
   * answer quality is enforced by density-lint instead.
   */
  faqs: z.array(z.object({ q: z.string(), a: z.string() })).max(6).default([]),
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
export const VariantKind = z.enum(['classic', 'modern', 'premium', 'bright', 'haul', 'counsel']);
export type VariantKind = z.infer<typeof VariantKind>;

export const ContentBundle = z.object({
  niche: z.string(),
  city: z.string(),
  state: z.string(),
  business_name: z.string(),
  variant: VariantKind.default('classic'),
  hero_image_prompt: z.string().optional(),
  hero_image_url: z.string().optional(),
  /**
   * Alt text for `hero_image_url`. A literal description of the image (not
   * the page topic) for screen readers and image SEO — mention the
   * business/city naturally, no keyword stuffing, <=125 chars.
   */
  hero_image_alt: z.string().max(125).optional(),
  /**
   * Optional YouTube embed shown directly under the hero. Manual-entry only —
   * operators paste a watch/share/embed URL into Sanity; agents never author
   * these. Renders only when video_url is present.
   */
  video_url: z.string().optional(),
  video_description: z.string().optional(),
  /**
   * Keyword-rich long-form home intro placed high on the page. Markdown
   * (renderer subset: headings, bullets, bold, links). Generated from the home
   * cluster at build time and backfillable via the long-form-only path.
   * longform_body is optional so legacy bundles validate; longform_generated_at
   * stamps when it was last produced.
   */
  longform_body: z.string().optional(),
  longform_generated_at: z.string().optional(),
  nearby_cities: z.array(z.string()).default([]),
  trust_signals: z.array(z.string()).default([]),
  /**
   * Geo coordinates for LocalBusiness `geo` (GeoCoordinates). Derived at build
   * time from the site's city/state centroid. Both must be present to emit.
   */
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  /**
   * Real, verifiable profile URLs for LocalBusiness `sameAs` — the partner
   * contractor's actual Google Business Profile plus any real socials.
   * Operator-entered; never fabricated.
   */
  same_as: z.array(z.string()).default([]),
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
  /**
   * Agent-authored standalone FAQ pages at /faq/[slug]. ONE question per page —
   * the page title and slug ARE the question — to win exact-match long-tail
   * relevancy (topical authority without GBP/backlinks). Distinct from
   * `Page.faqs` (the embedded Q&A accordion on service pages): these are their
   * own crawlable URLs, linked from a /faq hub in the visible nav. mdx is the
   * answer body. MUST be locally specific (city, niche, business) and sourced
   * from real demand — generic restated answers fail helpful-content and create
   * a network footprint when identical across sites.
   */
  faq_pages: z.array(Page).default([]),
  /**
   * Neighborhood list for the home page service-area section. Populated
   * post-LLM: the model emits names only; the content engine wraps each in
   * a Google Maps search URL before persisting. Thin-mode only (content_rich
   * uses service-area pages instead).
   */
  neighborhoods: z.array(
    z.object({
      name: z.string(),
      google_maps_url: z.string().url(),
    }),
  ).default([]),
  generated_at: z.string(),
});
export type ContentBundle = z.infer<typeof ContentBundle>;

export const TrackingNumber = z.object({
  number: z.string(),
  provider: z.enum(['twilio', 'mock']),
  /** Twilio IncomingPhoneNumber SID — needed to update forwarding/recording later. */
  twilio_sid: z.string().optional(),
  whisper: z.string().optional(),
  recording_enabled: z.boolean(),
});
export type TrackingNumber = z.infer<typeof TrackingNumber>;

// ────────────────────────────────────────────────────────────
// Sprint 3 — network-linker
// ────────────────────────────────────────────────────────────

export const CrossLinkTopology = z.enum([
  'same-niche-different-city',
  'same-city-different-niche',
  'out-of-network',
]);
export type CrossLinkTopology = z.infer<typeof CrossLinkTopology>;
