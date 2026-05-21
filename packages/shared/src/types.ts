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

/**
 * Payload for `agent_approvals.kind = 'cross_link_placement'`. Emitted by
 * network-linker and rendered in the operator approvals inbox.
 */
export const CrossLinkPlacementPayload = z.object({
  sourceSiteId: z.string().uuid(),
  sourcePageId: z.string(),
  sourcePageSlug: z.string(),
  targetSiteId: z.string().uuid(),
  targetUrl: z.string().url(),
  anchorText: z.string().min(1),
  topology: CrossLinkTopology,
  /** Sentence as it currently exists in the page MDX. */
  beforeSentence: z.string(),
  /** Sentence with the anchor inserted, as the LLM proposes. */
  afterSentence: z.string(),
  /** Optional reasoning string from the placement LLM for operator review. */
  rationale: z.string().optional(),
});
export type CrossLinkPlacementPayload = z.infer<typeof CrossLinkPlacementPayload>;
