import { createWriteClient } from '@leadlandlord/integrations/sanity';
import { buildsellSiteDocId, buildsellReviewDocId } from '@leadlandlord/sanity-schema/ids';
import { BS_SECTION_RULES, type BsSectionType } from '@leadlandlord/shared';
import type { SpecSiteContent } from './schema';

/**
 * Thrown when a rebuild is attempted on a live/handed-off site.
 *
 * Defined here (persist-sanity.ts) so both this module and index.ts can use
 * the same class without a circular import. index.ts re-exports it.
 */
export class RebuildProtectedError extends Error {
  constructor(siteId: string, status: string) {
    super(`Cannot rebuild site ${siteId}: status is '${status}'. Pass forceRebuild:true to override.`);
    this.name = 'RebuildProtectedError';
  }
}

/**
 * Operator-approved content migrated from the prospect's existing site
 * (content-migrator → review queue → applyMigrationSelections). The builder
 * reads this from the existing doc and re-applies it on every rebuild, so a
 * regen never clobbers approved real copy/images. Mirrors the `bsMigrated`
 * Sanity object. Asset ids are plain strings; we re-attach them as image refs.
 */
export interface MigratedUgcOverlayItem {
  platform: string;
  postUrl?: string | null;
  caption?: string | null;
  thumbnailAssetId?: string | null;
}

export interface MigratedOverlay {
  headline?: string | null;
  aboutBody?: string | null;
  services?: Array<{ icon: string; title: string; description: string }> | null;
  socials?: Array<{ platform: string; href: string }> | null;
  logoAssetId?: string | null;
  heroImageAssetId?: string | null;
  aboutImageAssetId?: string | null;
  ugc?: MigratedUgcOverlayItem[] | null;
  source?: string | null;
  migratedAt?: string | null;
}

/**
 * Customer-controlled section layout overlay stored at `buildsellSite.customerLayout`.
 * Written by the customer portal (Workstream D) and preserved verbatim by the builder
 * on every rebuild — exactly like `migrated`. The builder reads this to know:
 *   - which order to emit sections (sectionOrder)
 *   - which sections the customer deleted (removedKeys — builder skips these)
 *   - which sections contain customer-authored content (customerOwnedKeys — builder
 *     takes these verbatim from the existing Sanity doc rather than regenerating)
 *   - when the site was handed off / locked (lockedAt — signals no destructive rebuild)
 */
export interface CustomerLayoutOverlay {
  sectionOrder?: string[] | null;
  removedKeys?: string[] | null;
  customerOwnedKeys?: string[] | null;
  /** ISO datetime string set at handoff. Presence of siteStatus==='live' is the
   * authoritative gate; this field is informational for audit purposes. */
  lockedAt?: string | null;
}

/**
 * Operator-owned fields that survive a rebuild unchanged.
 * Populated by the builder by fetching the existing doc before writing.
 */
export interface ExistingDocFields {
  draftMode?: boolean | null;
  robotsDisallow?: boolean | null;
  purchaseUrl?: string | null;
  ownerEmail?: string | null;
  /** Preserved across rebuilds — mirrors buildsell_sites.klaviyo_list_id. */
  klaviyoListId?: string | null;
  /** Preserved when incoming payload has no street (reaped-lead rebuild degrades cleanly). */
  existingStreet?: string | null;
  /** Preserved when incoming payload has no phone (revise/rebuild keeps the NAP number). */
  existingPhone?: string | null;
  /** Approved migrated content — re-applied on every rebuild. */
  migrated?: MigratedOverlay | null;
  /** True when the buyer has confirmed their theme on the draft preview. */
  themeLocked?: boolean | null;
  /**
   * Buyer-confirmed theme fields — preserved on rebuild when themeLocked is true.
   * Only preset/layoutVariant/fontHeading/fontBody are locked; hex colors derive
   * from the preset name at render time.
   */
  existingTheme?: {
    preset?: string;
    layoutVariant?: string;
    fontHeading?: string;
    fontBody?: string;
  } | null;
  /**
   * Customer-controlled section layout overlay. Preserved verbatim on every
   * rebuild (same pattern as `migrated`). Absent on all existing sites — the
   * builder treats absence as "proceed normally" (backward-compatible).
   */
  customerLayout?: CustomerLayoutOverlay | null;
  /**
   * Full sections array from the existing doc. Used by the read-merge algorithm
   * to take customer-owned or customer-ordered sections verbatim. Only meaningful
   * when customerLayout.sectionOrder is present.
   */
  existingSections?: Array<Record<string, unknown>> | null;
}

export interface WriteBuildSellArgs {
  buildsellSiteId: string;
  businessName: string;
  trade: string;
  city: string;
  state: string;
  ownerEmail?: string | null;
  /** Set by ensureKlaviyoListForBuildSell before the Sanity write. Mirrored into the doc. */
  klaviyoListId?: string | null;
  /** Google Places place_id — stored verbatim. Null when unavailable. */
  placeId?: string | null;
  slug: string;
  content: SpecSiteContent;
  /** Sanity asset _id for the generated hero image, when one was produced. */
  heroImageAssetId?: string | null;
  /** Trust-layout hero strip tiles 2 & 3, when produced (variations of the hero). */
  heroImageBAssetId?: string | null;
  heroImageCAssetId?: string | null;
  /** Sanity asset _id for the favicon (logo-derived or generated monogram). */
  faviconAssetId?: string | null;
  /** Sanity asset _id for the generated about image, when one was produced. */
  aboutImageAssetId?: string | null;
  /** Sanity asset _id for the generated OG image, when one was produced. */
  ogImageAssetId?: string | null;
  generatedAt: string;
  /** Full display-line address (e.g. "2240 S Archibald Ave, Ontario, CA"). No parsing. */
  addressLine?: string | null;
  /** Business phone from Places cache — written to doc-root phone field. */
  phone?: string | null;
  /** Aggregate rating from buildsell_sites.metadata.rating */
  rating?: number | null;
  /** Review count from buildsell_sites.metadata.userRatingCount */
  reviewCount?: number | null;
  /** Purchase URL sourced from buildsell_sites.payment_link (set on sendInvoice). */
  purchaseUrl?: string | null;
  /**
   * Operator-owned fields read from the existing Sanity doc before write.
   * When present, these take precedence over defaults so rebuilds don't clobber
   * draftMode/robotsDisallow/purchaseUrl/ownerEmail (D4 read-merge policy).
   */
  existingDoc?: ExistingDocFields | null;
  /**
   * Postgres buildsell_sites.status for this site. Used to enforce the handoff
   * lock: if status is 'live', writeBuildSellToSanity refuses a destructive
   * rebuild (defense-in-depth; the agent's execute() also gates on this earlier).
   * Optional so the signature is backward-compatible with any direct callers.
   */
  siteStatus?: string | null;
}

export interface WriteBuildSellResult {
  docId: string;
  reviewDocIds: string[];
  transactionId: string;
  sectionCount: number;
}

// ---------------------------------------------------------------------------
// Section read-merge helpers
// ---------------------------------------------------------------------------

/**
 * Build the canonical sections array the builder would produce from scratch.
 * Keys are the stable semantic identifiers used by image-regen patch paths:
 *   sections[_key=="hero"].image, sections[_key=="about"].image, etc.
 *
 * Extracted from writeBuildSellToSanity so the merge algorithm can compare
 * builder-canonical sections against the existing doc's sections.
 */
function buildCanonicalSections(
  content: SpecSiteContent,
  {
    heroHeadline,
    heroHighlight,
    aboutBody,
    heroImageAssetId,
    heroImageBAssetId,
    heroImageCAssetId,
    aboutImageAssetId,
    serviceCards,
    footerSocial,
    reviewDocIds,
    streetToWrite,
    city,
    state,
    m,
  }: {
    heroHeadline: string;
    heroHighlight: string | undefined;
    aboutBody: string;
    heroImageAssetId: string | null;
    heroImageBAssetId: string | null;
    heroImageCAssetId: string | null;
    aboutImageAssetId: string | null;
    serviceCards: Array<{ icon: string; title: string; description: string; link?: string }>;
    footerSocial: Array<{ platform: string; href: string }>;
    reviewDocIds: string[];
    streetToWrite: string | undefined;
    city: string;
    state: string;
    m: MigratedOverlay | null;
  },
): Array<Record<string, unknown>> {
  const sections: Array<Record<string, unknown>> = [
    {
      _key: 'hero',
      _type: 'bsHeroSection',
      eyebrow: content.hero.eyebrow,
      headline: heroHeadline,
      highlight: heroHighlight,
      subhead: content.hero.subhead,
      showRating: true,
      badges: content.hero.badges.map((b, i) => ({ _key: `bdg${i}`, _type: 'bsTrustBadge', ...b })),
      primaryCta: { _type: 'bsCtaButton', ...content.hero.primaryCta },
      secondaryCta: { _type: 'bsCtaButton', ...content.hero.secondaryCta },
      ...(heroImageAssetId
        ? { image: { _type: 'image', asset: { _type: 'reference', _ref: heroImageAssetId } } }
        : {}),
      ...(heroImageBAssetId
        ? { imageB: { _type: 'image', asset: { _type: 'reference', _ref: heroImageBAssetId } } }
        : {}),
      ...(heroImageCAssetId
        ? { imageC: { _type: 'image', asset: { _type: 'reference', _ref: heroImageCAssetId } } }
        : {}),
    },
    {
      _key: 'services',
      _type: 'bsServicesSection',
      ...(content.services.eyebrow ? { eyebrow: content.services.eyebrow } : {}),
      // B-HEADINGS fix: heading comes from model output, never hardcoded.
      heading: content.services.heading,
      subhead: content.services.subhead ?? undefined,
      services: serviceCards.map((s, i) => ({
        _key: `svc${i}`,
        _type: 'bsServiceCard',
        icon: s.icon,
        title: s.title,
        description: s.description,
        ...('link' in s && s.link ? { link: s.link } : {}),
      })),
    },
    {
      _key: 'about',
      _type: 'bsAboutSection',
      ...(content.about.eyebrow ? { eyebrow: content.about.eyebrow } : {}),
      heading: content.about.heading,
      body: aboutBody,
      stats: content.about.stats.map((s, i) => ({ _key: `st${i}`, _type: 'bsStatItem', ...s })),
      ...(content.about.cta ? { cta: { _type: 'bsCtaButton', ...content.about.cta } } : {}),
      ...(aboutImageAssetId
        ? { image: { _type: 'image', asset: { _type: 'reference', _ref: aboutImageAssetId } } }
        : {}),
    },
    {
      _key: 'process',
      _type: 'bsProcessSection',
      ...(content.process.eyebrow ? { eyebrow: content.process.eyebrow } : {}),
      heading: content.process.heading,
      steps: content.process.steps.map((s, i) => ({ _key: `ps${i}`, _type: 'bsProcessStep', ...s })),
    },
    {
      _key: 'reviews',
      _type: 'bsReviewsSection',
      ...(content.reviews.eyebrow ? { eyebrow: content.reviews.eyebrow } : {}),
      // B-HEADINGS fix: heading comes from model output, never hardcoded.
      heading: content.reviews.heading,
      showRating: true,
      reviews: reviewDocIds.map((id, i) => ({ _key: `rev${i}`, _type: 'reference', _ref: id })),
    },
    {
      _key: 'contact',
      _type: 'bsContactSection',
      heading: content.contact.heading,
      subhead: content.contact.subhead,
      // Lead form POST target — default the standard endpoint when the model omits it.
      formEndpoint: content.contact.formEndpoint ?? '/api/bs/lead',
      // Render controls — default showDetails on, showMap off (per design).
      showDetails: content.contact.showDetails ?? true,
      showMap: content.contact.showMap ?? false,
      ...(content.contact.formLabels
        ? {
            formLabels: {
              _type: 'bsFormLabels',
              ...content.contact.formLabels,
            },
          }
        : {}),
      address: {
        _type: 'bsAddress',
        street: streetToWrite,
        city,
        state,
        hours: content.contact.hours,
        serviceArea: content.contact.serviceArea,
      },
    },
    // Social gallery — materialized from the migration overlay only (no model
    // content drives it). Omitted entirely when there are no approved items.
    ...(m?.ugc && m.ugc.length > 0
      ? [
          {
            _key: 'ugc',
            _type: 'bsUgcSection',
            heading: 'From Our Community',
            items: m.ugc.map((u, i) => ({
              _key: `ugc${i}`,
              _type: 'bsUgcItem',
              platform: u.platform,
              ...(u.postUrl ? { postUrl: u.postUrl } : {}),
              ...(u.caption ? { caption: u.caption } : {}),
              order: i,
              ...(u.thumbnailAssetId
                ? { thumbnail: { _type: 'image', asset: { _type: 'reference', _ref: u.thumbnailAssetId } } }
                : {}),
            })),
          },
        ]
      : []),
    {
      _key: 'footer',
      _type: 'bsFooterSection',
      tagline: content.footer.tagline,
      legal: content.footer.legal,
      columns: (content.footer.columns ?? []).map((col, i) => ({
        _key: `fcol${i}`,
        _type: 'bsFooterColumn',
        heading: col.heading,
        links: col.links.map((l, j) => ({ _key: `fcl${i}_${j}`, _type: 'bsNavLink', ...l })),
      })),
      social: footerSocial.map((s, i) => ({
        _key: `soc${i}`,
        _type: 'bsSocialLink',
        platform: s.platform,
        href: s.href,
      })),
      legalLinks: (content.footer.legalLinks ?? []).map((l, i) => ({
        _key: `ll${i}`,
        _type: 'bsNavLink',
        ...l,
      })),
    },
  ];

  return sections;
}

/**
 * Merge builder-canonical sections with the customer layout overlay.
 *
 * Algorithm (per Workstream C spec):
 *
 * 1. No `customerLayout.sectionOrder` → return canonical sections unchanged
 *    (backward-compatible: all existing sites have no customerLayout).
 *
 * 2. Build a map of `_key → existing section object` from the existing doc.
 *
 * 3. Emit sections in `sectionOrder` order:
 *    - Key in `removedKeys` → skip (customer deleted it).
 *    - Key in `customerOwnedKeys` → take the existing object verbatim (customer edited it).
 *    - Otherwise → use the builder's freshly-generated canonical block for that `_key`.
 *
 * 4. Canonical sections whose `_key` is NOT in `sectionOrder` AND NOT in
 *    `removedKeys` (e.g. a new section type added in a later release) → append
 *    after the customer's last non-footer section, keeping footer last.
 *
 * Returns the merged sections array.
 */
function mergeSections(
  canonicalSections: Array<Record<string, unknown>>,
  existingSections: Array<Record<string, unknown>>,
  customerLayout: CustomerLayoutOverlay,
): Array<Record<string, unknown>> {
  const sectionOrder = customerLayout.sectionOrder;
  if (!sectionOrder || sectionOrder.length === 0) {
    // No order directive — proceed exactly as today (backward-compatible).
    return canonicalSections;
  }

  const removedKeys = new Set(customerLayout.removedKeys ?? []);
  const customerOwnedKeys = new Set(customerLayout.customerOwnedKeys ?? []);

  // Map existing doc sections by _key for O(1) lookup.
  const existingByKey = new Map<string, Record<string, unknown>>();
  for (const sec of existingSections) {
    const key = typeof sec['_key'] === 'string' ? sec['_key'] : null;
    if (key) existingByKey.set(key, sec);
  }

  // Map canonical sections by _key for builder-fresh lookup.
  const canonicalByKey = new Map<string, Record<string, unknown>>();
  for (const sec of canonicalSections) {
    const key = typeof sec['_key'] === 'string' ? sec['_key'] : null;
    if (key) canonicalByKey.set(key, sec);
  }

  // Track which canonical keys we've emitted so we can append new ones later.
  const emittedCanonicalKeys = new Set<string>();

  const merged: Array<Record<string, unknown>> = [];

  for (const key of sectionOrder) {
    // Skip keys the customer explicitly removed.
    if (removedKeys.has(key)) continue;

    if (customerOwnedKeys.has(key)) {
      // Customer-owned: take the existing Sanity object verbatim.
      // If somehow missing from existing (shouldn't happen), fall through to canonical.
      const existing = existingByKey.get(key);
      if (existing) {
        merged.push(existing);
        emittedCanonicalKeys.add(key);
        continue;
      }
    }

    // Builder-canonical key: use the freshly-generated block if available.
    const canonical = canonicalByKey.get(key);
    if (canonical) {
      merged.push(canonical);
      emittedCanonicalKeys.add(key);
      continue;
    }

    // Key from sectionOrder not found in canonical and not customer-owned:
    // this is a customer-added section (generated key from Workstream D).
    // Take it verbatim from the existing doc.
    const existing = existingByKey.get(key);
    if (existing) {
      merged.push(existing);
    }
    // If neither exists, silently drop (orphaned key — e.g. doc was manually patched).
  }

  // Append any canonical sections that are new (not in sectionOrder and not removed).
  // Keep footer always last: separate footer from the rest, insert non-footer new
  // sections after the last non-footer merged section, then re-append footer.
  const newCanonical: Array<Record<string, unknown>> = [];
  const footerKey = 'footer';
  let footerSection: Record<string, unknown> | undefined;

  for (const sec of canonicalSections) {
    const key = typeof sec['_key'] === 'string' ? sec['_key'] : '';
    if (emittedCanonicalKeys.has(key)) continue;
    if (removedKeys.has(key)) continue;
    if (key === footerKey) {
      footerSection = sec;
    } else {
      newCanonical.push(sec);
    }
  }

  if (newCanonical.length > 0) {
    // Find the last non-footer section in merged and insert after it.
    let lastNonFooterIdx = -1;
    for (let i = merged.length - 1; i >= 0; i--) {
      const sec = merged[i];
      const key = sec && typeof sec['_key'] === 'string' ? sec['_key'] : '';
      if (key !== footerKey) {
        lastNonFooterIdx = i;
        break;
      }
    }
    merged.splice(lastNonFooterIdx + 1, 0, ...newCanonical);
  }

  // Ensure footer section is present and last (it's a singleton that can't be removed).
  // If footer was already emitted via sectionOrder (normal case), it's already there.
  // If not emitted but exists in canonical, append it now.
  const alreadyHasFooter = merged.some((s) => typeof s['_key'] === 'string' && s['_key'] === footerKey);
  if (!alreadyHasFooter && footerSection) {
    merged.push(footerSection);
  }

  return merged;
}

/**
 * Persist a generated spec site to Sanity as a `buildsellSite` doc plus its
 * `bsReview` docs, in one transaction.
 *
 * D4 read-merge: operator-owned fields (draftMode, robotsDisallow, purchaseUrl,
 * ownerEmail, existingStreet) are carried from `args.existingDoc` so rebuilds
 * never silently de-index a live site or wipe the purchase URL.
 *
 * B-COLOR: all 8 theme colors are written as `{_type:'color',hex}` objects.
 * B-HEADINGS: headings come from model output (args.content), never hardcoded.
 *
 * Workstream C — section read-merge:
 * When `args.existingDoc.customerLayout.sectionOrder` is present, the merged
 * sections array respects the customer's ordering, preserves customer-owned
 * content verbatim, and skips removed keys. customerLayout is re-emitted
 * unchanged in the write payload (same preservation as `migrated`).
 *
 * Workstream C — handoff lock (defense-in-depth):
 * If `args.siteStatus === 'live'`, refuses the write with RebuildProtectedError.
 * The agent's execute() already gates on this earlier; this is a second line of
 * defense in case writeBuildSellToSanity is called directly by other code paths.
 *
 * Deterministic ids: `bs-site-${id}`, `bs-review-${id}-N` — keep idempotent.
 */
export async function writeBuildSellToSanity(args: WriteBuildSellArgs): Promise<WriteBuildSellResult> {
  const { content } = args;
  const client = createWriteClient();
  const docId = buildsellSiteDocId(args.buildsellSiteId);
  const tx = client.transaction();

  // Workstream C — handoff lock (defense-in-depth).
  // The agent's execute() already throws RebuildProtectedError before reaching
  // this point for 'paid' and 'live' sites. This guard catches any direct caller
  // that bypasses the agent (e.g. scripts, future routes).
  if (args.siteStatus === 'live') {
    throw new RebuildProtectedError(args.buildsellSiteId, args.siteStatus);
  }

  const ex = args.existingDoc ?? {};

  // Review docs first — referenced by the reviews section.
  const reviewDocIds: string[] = [];
  content.reviews.items.forEach((r, i) => {
    const id = buildsellReviewDocId(`${args.buildsellSiteId}-${i}`);
    reviewDocIds.push(id);
    // Derive initials: prefer explicit field, else take first chars of author words.
    const derivedInitials = r.author
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => (w[0] ?? ''))
      .join('')
      .toUpperCase();
    const initials = r.initials ?? (derivedInitials.length > 0 ? derivedInitials : undefined);
    tx.createOrReplace({
      _id: id,
      _type: 'bsReview',
      buildsellSiteId: args.buildsellSiteId,
      author: r.author,
      initials,
      rating: r.rating,
      text: r.text,
      location: r.location ?? undefined,
      /**
       * ToS guard: source is ALWAYS 'manual' for model-generated content.
       * Never 'google' on a generated testimonial (R6 / ADR 0025 D5).
       */
      source: 'manual',
      date: new Date().toISOString().slice(0, 10),
      featured: i < 3,
      order: i,
    });
  });

  // Resolve address: prefer incoming payload; fall back to existing doc's street
  // so a reaped-lead rebuild doesn't blank the field.
  const streetToWrite = args.addressLine ?? ex.existingStreet ?? undefined;

  // Migration overlay (operator-approved). Applied AFTER the builder's lint
  // (which runs in index.ts on generated content only), so approved real copy
  // bypasses the invention-guard. Everything migration-owned is re-derived
  // from this object on each rebuild — that's what makes it durable.
  const m = ex.migrated ?? null;
  const heroHeadline = m?.headline?.trim() || content.hero.headline;
  // Drop the model's highlight fragment when a migrated headline replaces it
  // (the fragment likely no longer appears in the new headline).
  const heroHighlight = m?.headline ? undefined : content.hero.highlight;
  const aboutBody = m?.aboutBody?.trim() || content.about.body;
  const heroImageAssetId = m?.heroImageAssetId ?? args.heroImageAssetId ?? null;
  const heroImageBAssetId = args.heroImageBAssetId ?? null;
  const heroImageCAssetId = args.heroImageCAssetId ?? null;
  const aboutImageAssetId = m?.aboutImageAssetId ?? args.aboutImageAssetId ?? null;
  const serviceCards =
    m?.services && m.services.length > 0
      ? m.services.map((s) => ({ icon: s.icon, title: s.title, description: s.description }))
      : content.services.cards;
  const footerSocial =
    m?.socials && m.socials.length > 0 ? m.socials : (content.footer.social ?? []);

  // Build the builder's canonical sections array (the hardcoded sequence, same
  // as before Workstream C). This is always correct for new/fresh builds.
  const canonicalSections = buildCanonicalSections(content, {
    heroHeadline,
    heroHighlight,
    aboutBody,
    heroImageAssetId,
    heroImageBAssetId,
    heroImageCAssetId,
    aboutImageAssetId,
    serviceCards,
    footerSocial,
    reviewDocIds,
    streetToWrite,
    city: args.city,
    state: args.state,
    m,
  });

  // Workstream C — section read-merge.
  //
  // If customerLayout.sectionOrder is present, produce the merged sections array
  // that respects the customer's ordering while refreshing builder-owned content.
  // If absent (all existing sites), return canonical unchanged (backward-compatible).
  const customerLayout = ex.customerLayout ?? null;
  const existingSections = ex.existingSections ?? [];
  const sections =
    customerLayout?.sectionOrder && customerLayout.sectionOrder.length > 0
      ? mergeSections(canonicalSections, existingSections, customerLayout)
      : canonicalSections;

  // D4 read-merge: prefer existing operator-owned values; fall back to safe defaults.
  const draftMode = ex.draftMode !== undefined && ex.draftMode !== null ? ex.draftMode : true;
  const robotsDisallow = ex.robotsDisallow !== undefined && ex.robotsDisallow !== null ? ex.robotsDisallow : true;
  const purchaseUrl = args.purchaseUrl ?? ex.purchaseUrl ?? undefined;
  // ownerEmail: prefer incoming arg (operator may have updated via UI); fall back to existing.
  const ownerEmail = args.ownerEmail ?? ex.ownerEmail ?? undefined;
  // klaviyoListId: same precedence — incoming arg (freshly provisioned or operator retry) wins.
  const klaviyoListId = args.klaviyoListId ?? ex.klaviyoListId ?? undefined;

  tx.createOrReplace({
    _id: docId,
    _type: 'buildsellSite',
    buildsellSiteId: args.buildsellSiteId,
    businessName: args.businessName,
    trade: args.trade,
    city: args.city,
    state: args.state,
    // Keep the existing NAP phone when this run carries none (revise/rebuild).
    phone: args.phone ?? ex.existingPhone ?? undefined,
    ownerEmail: ownerEmail ?? undefined,
    klaviyoListId: klaviyoListId ?? undefined,
    placeId: args.placeId ?? undefined,
    slug: { _type: 'slug', current: args.slug },
    navigation: content.navigation.map((n, i) => ({ _key: `nav${i}`, _type: 'bsNavLink', ...n })),
    // Nav-level CTA + phone toggle (doc-root; already in the GROQ projection).
    // navShowPhone defaults true at the renderer when omitted.
    ...(content.navCta ? { navCta: { _type: 'bsCtaButton', ...content.navCta } } : {}),
    ...(content.navShowPhone !== undefined ? { navShowPhone: content.navShowPhone } : {}),
    // NOTE: doc-root `email`, `socials`, and `address` are intentionally left
    // unpopulated — no renderer reads them (footer socials/address come from the
    // footer/contact section blocks). Schema fields are retained, not written.
    // Colors are 100% preset-driven at render time (per-doc hex fields removed
    // 2026-06-19). Only the preset name, layout, and fonts are persisted.
    theme: {
      _type: 'buildsellTheme',
      preset: content.theme.preset,
      layoutVariant: content.theme.layoutVariant,
      fontHeading: content.theme.fontHeading,
      fontBody: content.theme.fontBody,
    },
    draftMode,
    robotsDisallow,
    // Preserve themeLocked: if the buyer confirmed their theme, keep the flag
    // so future rebuilds still honour it (createOrReplace would otherwise erase it).
    ...(ex.themeLocked === true ? { themeLocked: true } : {}),
    // Doc-root fields from Phase 1 schema additions:
    rating: args.rating ?? undefined,
    reviewCount: args.reviewCount ?? undefined,
    purchaseUrl: purchaseUrl ?? undefined,
    heroImagePrompt: content.hero.imagePrompt,
    aboutImagePrompt: content.about.imagePrompt ?? undefined,
    ogImagePrompt: content.seo.ogImagePrompt ?? undefined,
    seo: {
      _type: 'bsSeo',
      metaTitle: content.seo.metaTitle,
      metaDescription: content.seo.metaDescription,
      ...(args.ogImageAssetId
        ? { ogImage: { _type: 'image', asset: { _type: 'reference', _ref: args.ogImageAssetId } } }
        : {}),
    },
    // Doc-root logo from the migration overlay (createOrReplace would otherwise
    // drop it on rebuild — it lives only here, not in generated content).
    ...(m?.logoAssetId
      ? { logo: { _type: 'image', asset: { _type: 'reference', _ref: m.logoAssetId } } }
      : {}),
    ...(args.faviconAssetId
      ? { favicon: { _type: 'image', asset: { _type: 'reference', _ref: args.faviconAssetId } } }
      : {}),
    // Re-emit the migration overlay so it survives the next createOrReplace.
    ...(m
      ? {
          migrated: {
            _type: 'bsMigrated',
            ...(m.headline ? { headline: m.headline } : {}),
            ...(m.aboutBody ? { aboutBody: m.aboutBody } : {}),
            ...(m.services && m.services.length > 0
              ? {
                  services: m.services.map((s, i) => ({
                    _key: `msvc${i}`,
                    _type: 'bsServiceCard',
                    icon: s.icon,
                    title: s.title,
                    description: s.description,
                  })),
                }
              : {}),
            ...(m.socials && m.socials.length > 0
              ? {
                  socials: m.socials.map((s, i) => ({
                    _key: `msoc${i}`,
                    _type: 'bsSocialLink',
                    platform: s.platform,
                    href: s.href,
                  })),
                }
              : {}),
            ...(m.logoAssetId ? { logoAssetId: m.logoAssetId } : {}),
            ...(m.heroImageAssetId ? { heroImageAssetId: m.heroImageAssetId } : {}),
            ...(m.aboutImageAssetId ? { aboutImageAssetId: m.aboutImageAssetId } : {}),
            ...(m.ugc && m.ugc.length > 0
              ? {
                  ugc: m.ugc.map((u, i) => ({
                    _key: `mugc${i}`,
                    _type: 'bsMigratedUgcItem',
                    platform: u.platform,
                    ...(u.postUrl ? { postUrl: u.postUrl } : {}),
                    ...(u.caption ? { caption: u.caption } : {}),
                    ...(u.thumbnailAssetId ? { thumbnailAssetId: u.thumbnailAssetId } : {}),
                  })),
                }
              : {}),
            ...(m.source ? { source: m.source } : {}),
            ...(m.migratedAt ? { migratedAt: m.migratedAt } : {}),
          },
        }
      : {}),
    // Workstream C — re-emit customerLayout unchanged so the customer's section
    // ordering, removals, and customer-owned flags survive every rebuild.
    // This is the same preservation pattern as `migrated` above. Without this,
    // createOrReplace would silently drop the overlay on the next build.
    //
    // lockedAt is set by the customer portal (Workstream D) at handoff time.
    // We do NOT set it here: by the time siteStatus==='live' we throw above,
    // so we never reach this point on a live site. Any non-live path that
    // reaches here just preserves whatever lockedAt the portal already set.
    ...(customerLayout
      ? {
          customerLayout: {
            _type: 'bsCustomerLayout',
            ...(customerLayout.sectionOrder ? { sectionOrder: customerLayout.sectionOrder } : {}),
            ...(customerLayout.removedKeys ? { removedKeys: customerLayout.removedKeys } : {}),
            ...(customerLayout.customerOwnedKeys ? { customerOwnedKeys: customerLayout.customerOwnedKeys } : {}),
            ...(customerLayout.lockedAt ? { lockedAt: customerLayout.lockedAt } : {}),
          },
        }
      : {}),
    sections,
    generatedAt: args.generatedAt,
  });

  const res = await tx.commit({ visibility: 'sync' });
  return { docId, reviewDocIds, transactionId: res.transactionId, sectionCount: sections.length };
}

// Re-export BS_SECTION_RULES for convenience (callers in agents that need the
// ruleset alongside the write function don't need a separate import).
export { BS_SECTION_RULES };
