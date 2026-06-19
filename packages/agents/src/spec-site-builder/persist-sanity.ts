import { createWriteClient } from '@leadlandlord/integrations/sanity';
import { buildsellSiteDocId, buildsellReviewDocId } from '@leadlandlord/sanity-schema/ids';
import type { SpecSiteContent } from './schema';

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
 * Operator-owned fields that survive a rebuild unchanged.
 * Populated by the builder by fetching the existing doc before writing.
 */
export interface ExistingDocFields {
  draftMode?: boolean | null;
  robotsDisallow?: boolean | null;
  purchaseUrl?: string | null;
  ownerEmail?: string | null;
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
}

export interface WriteBuildSellArgs {
  buildsellSiteId: string;
  businessName: string;
  trade: string;
  city: string;
  state: string;
  ownerEmail?: string | null;
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
}

export interface WriteBuildSellResult {
  docId: string;
  reviewDocIds: string[];
  transactionId: string;
  sectionCount: number;
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
 * Deterministic ids: `bs-site-${id}`, `bs-review-${id}-N` — keep idempotent.
 */
export async function writeBuildSellToSanity(args: WriteBuildSellArgs): Promise<WriteBuildSellResult> {
  const { content } = args;
  const client = createWriteClient();
  const docId = buildsellSiteDocId(args.buildsellSiteId);
  const tx = client.transaction();

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

  const sections = [
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
      heading: content.about.heading,
      body: aboutBody,
      stats: content.about.stats.map((s, i) => ({ _key: `st${i}`, _type: 'bsStatItem', ...s })),
      ...(aboutImageAssetId
        ? { image: { _type: 'image', asset: { _type: 'reference', _ref: aboutImageAssetId } } }
        : {}),
    },
    {
      _key: 'process',
      _type: 'bsProcessSection',
      heading: content.process.heading,
      steps: content.process.steps.map((s, i) => ({ _key: `ps${i}`, _type: 'bsProcessStep', ...s })),
    },
    {
      _key: 'reviews',
      _type: 'bsReviewsSection',
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
        city: args.city,
        state: args.state,
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
        links: col.links.map((l, j) => ({ _key: `fcl${i}_${j}`, _type: 'bsFooterLink', ...l })),
      })),
      social: footerSocial.map((s, i) => ({
        _key: `soc${i}`,
        _type: 'bsSocialLink',
        platform: s.platform,
        href: s.href,
      })),
      legalLinks: (content.footer.legalLinks ?? []).map((l, i) => ({
        _key: `ll${i}`,
        _type: 'bsLegalLink',
        ...l,
      })),
    },
  ];

  // D4 read-merge: prefer existing operator-owned values; fall back to safe defaults.
  const draftMode = ex.draftMode !== undefined && ex.draftMode !== null ? ex.draftMode : true;
  const robotsDisallow = ex.robotsDisallow !== undefined && ex.robotsDisallow !== null ? ex.robotsDisallow : true;
  const purchaseUrl = args.purchaseUrl ?? ex.purchaseUrl ?? undefined;
  // ownerEmail: prefer incoming arg (operator may have updated via UI); fall back to existing.
  const ownerEmail = args.ownerEmail ?? ex.ownerEmail ?? undefined;

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
    placeId: args.placeId ?? undefined,
    slug: { _type: 'slug', current: args.slug },
    navigation: content.navigation.map((n, i) => ({ _key: `nav${i}`, _type: 'bsNavLink', ...n })),
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
    sections,
    generatedAt: args.generatedAt,
  });

  const res = await tx.commit({ visibility: 'sync' });
  return { docId, reviewDocIds, transactionId: res.transactionId, sectionCount: sections.length };
}
