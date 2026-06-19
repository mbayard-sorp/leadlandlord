import { createWriteClient } from '@leadlandlord/integrations/sanity';
import { buildsellSiteDocId, buildsellReviewDocId } from '@leadlandlord/sanity-schema/ids';
import type { SpecSiteContent } from './schema';

export interface WriteBuildSellArgs {
  buildsellSiteId: string;
  businessName: string;
  trade: string;
  city: string;
  state: string;
  ownerEmail?: string | null;
  /** Google Places place_id — stored verbatim; used to build a Maps link. Null when unavailable. */
  placeId?: string | null;
  slug: string;
  content: SpecSiteContent;
  /** Sanity asset _id for the generated hero image, when one was produced. */
  heroImageAssetId?: string | null;
  generatedAt: string;
}

export interface WriteBuildSellResult {
  docId: string;
  reviewDocIds: string[];
  transactionId: string;
  sectionCount: number;
}

/**
 * Persist a generated spec site to Sanity as a `buildsellSite` doc plus its
 * `bsReview` docs, in one transaction. Always written `draftMode: true,
 * robotsDisallow: true` — markPaid (Phase 5) flips both. Deterministic ids
 * (`bs-site-${id}`, `bs-review-${id}-N`) keep re-runs idempotent.
 *
 * Modeled on writeSiteToSanity but fully B&S-namespaced — it NEVER touches an
 * R&R `site`/`page`/`theme` doc.
 */
export async function writeBuildSellToSanity(args: WriteBuildSellArgs): Promise<WriteBuildSellResult> {
  const { content } = args;
  const client = createWriteClient();
  const docId = buildsellSiteDocId(args.buildsellSiteId);
  const tx = client.transaction();

  // Review docs first — referenced by the reviews section.
  const reviewDocIds: string[] = [];
  content.reviews.forEach((r, i) => {
    const id = buildsellReviewDocId(`${args.buildsellSiteId}-${i}`);
    reviewDocIds.push(id);
    tx.createOrReplace({
      _id: id,
      _type: 'bsReview',
      buildsellSiteId: args.buildsellSiteId,
      author: r.author,
      rating: r.rating,
      text: r.text,
      featured: i < 3,
      order: i,
    });
  });

  const sections = [
    {
      _key: 'hero',
      _type: 'bsHeroSection',
      eyebrow: content.hero.eyebrow,
      headline: content.hero.headline,
      highlight: content.hero.highlight,
      subhead: content.hero.subhead,
      showRating: true,
      badges: content.hero.badges.map((b, i) => ({ _key: `bdg${i}`, _type: 'bsTrustBadge', ...b })),
      primaryCta: { _type: 'bsCtaButton', ...content.hero.primaryCta },
      secondaryCta: { _type: 'bsCtaButton', ...content.hero.secondaryCta },
      ...(args.heroImageAssetId
        ? { image: { _type: 'image', asset: { _type: 'reference', _ref: args.heroImageAssetId } } }
        : {}),
    },
    {
      _key: 'services',
      _type: 'bsServicesSection',
      heading: 'Our Services',
      services: content.services.map((s, i) => ({ _key: `svc${i}`, _type: 'bsServiceCard', ...s })),
    },
    {
      _key: 'about',
      _type: 'bsAboutSection',
      heading: content.about.heading,
      body: content.about.body,
      stats: content.about.stats.map((s, i) => ({ _key: `st${i}`, _type: 'bsStatItem', ...s })),
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
      heading: 'What Customers Say',
      showRating: true,
      reviews: reviewDocIds.map((id, i) => ({ _key: `rev${i}`, _type: 'reference', _ref: id })),
    },
    {
      _key: 'contact',
      _type: 'bsContactSection',
      heading: content.contact.heading,
      subhead: content.contact.subhead,
      address: {
        _type: 'bsAddress',
        city: args.city,
        state: args.state,
        hours: content.contact.hours,
        serviceArea: content.contact.serviceArea,
      },
    },
    {
      _key: 'footer',
      _type: 'bsFooterSection',
      tagline: content.footer.tagline,
      legal: content.footer.legal,
      columns: [],
      social: [],
    },
  ];

  tx.createOrReplace({
    _id: docId,
    _type: 'buildsellSite',
    buildsellSiteId: args.buildsellSiteId,
    businessName: args.businessName,
    trade: args.trade,
    city: args.city,
    state: args.state,
    ownerEmail: args.ownerEmail ?? undefined,
    placeId: args.placeId ?? undefined,
    slug: { _type: 'slug', current: args.slug },
    navigation: content.navigation.map((n, i) => ({ _key: `nav${i}`, _type: 'bsNavLink', ...n })),
    theme: { _type: 'buildsellTheme', ...content.theme },
    draftMode: true,
    robotsDisallow: true,
    seo: { _type: 'bsSeo', metaTitle: content.seo.metaTitle, metaDescription: content.seo.metaDescription },
    sections,
    generatedAt: args.generatedAt,
  });

  const res = await tx.commit({ visibility: 'sync' });
  return { docId, reviewDocIds, transactionId: res.transactionId, sectionCount: sections.length };
}
