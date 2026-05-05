import type { ContentBundle, Page } from '@leadlandlord/shared/types';
import {
  createWriteClient,
  siteDocId,
  pageDocId,
  themeDocId,
  type PageKind,
} from '@leadlandlord/integrations/sanity';

export interface WriteSiteToSanityOptions {
  /** Override Sanity dataset (defaults to env). Used by dry-run for `development`. */
  dataset?: string;
}

export interface WriteSiteToSanityResult {
  /** Sanity site doc _id (always `site-${siteId}`). */
  siteDocId: string;
  /** Page docs created/replaced — one per kind+index pair. */
  pageDocIds: string[];
  /** Sanity transactionId — useful for log correlation + write-after-read. */
  transactionId: string;
  /** Total page docs written (home + about + contact + services + ...). */
  pagesWritten: number;
}

interface PageRef {
  kind: PageKind;
  index: number;
  page: Page;
}

/**
 * Persist a generated content bundle to Sanity. Idempotent — re-running for
 * the same siteId overwrites every doc in place via deterministic IDs +
 * `createOrReplace`. References stay valid because the page doc IDs are
 * derived from (siteId, kind, index).
 *
 * The site doc gets a `theme` reference based on `bundle.variant`. Operators
 * can swap the theme post-hoc from the dashboard without re-running the
 * Site Builder.
 *
 * Caller is responsible for the hero-image upload + asset patch — see
 * `@leadlandlord/integrations/sanity::uploadHeroImage`.
 */
export async function writeSiteToSanity(
  siteId: string,
  bundle: ContentBundle,
  opts: WriteSiteToSanityOptions = {},
): Promise<WriteSiteToSanityResult> {
  const client = createWriteClient(opts.dataset ? { dataset: opts.dataset } : {});

  // Flatten the bundle into a single list of (kind, index, page) so we can
  // build deterministic IDs uniformly.
  const refs: PageRef[] = [
    { kind: 'home', index: 0, page: bundle.home },
    { kind: 'about', index: 0, page: bundle.about },
    { kind: 'contact', index: 0, page: bundle.contact },
    ...bundle.services.map((p, i) => ({ kind: 'service' as PageKind, index: i, page: p })),
    ...bundle.service_areas.map((p, i) => ({ kind: 'service_area' as PageKind, index: i, page: p })),
    ...bundle.blog_posts.map((p, i) => ({ kind: 'blog' as PageKind, index: i, page: p })),
    ...bundle.info_pages.map((p, i) => ({ kind: 'info' as PageKind, index: i, page: p })),
  ];

  const siteRef = siteDocId(siteId);
  const tx = client.transaction();

  // Pages first — referenced by the site doc.
  const pageIds: string[] = [];
  for (const ref of refs) {
    const id = pageDocId(siteId, ref.kind, ref.index);
    pageIds.push(id);
    tx.createOrReplace({
      _id: id,
      _type: 'page',
      site: { _ref: siteRef, _type: 'reference' },
      kind: ref.kind,
      slug: ref.page.slug,
      title: ref.page.title,
      metaDescription: ref.page.meta_description,
      mdx: ref.page.mdx,
      jsonLd: ref.page.schema_org_jsonld != null
        ? JSON.stringify(ref.page.schema_org_jsonld)
        : undefined,
    });
  }

  // Site doc — references all pages by deterministic id. _key fields keep
  // Sanity happy on array members (required for previewless ordering).
  tx.createOrReplace({
    _id: siteRef,
    _type: 'site',
    siteId,
    slug: { _type: 'slug', current: bundleSlug(bundle) },
    businessName: bundle.business_name,
    niche: bundle.niche,
    city: bundle.city,
    state: bundle.state,
    theme: { _ref: themeDocId(bundle.variant), _type: 'reference' },
    domains: [], // populated by the operator dashboard via Vercel Domains API
    robotsDisallow: true, // default during warming — operator flips when going live
    trustSignals: bundle.trust_signals ?? [],
    nearbyCities: bundle.nearby_cities ?? [],
    heroImagePrompt: bundle.hero_image_prompt ?? undefined,
    // heroImage asset is patched separately after generation — see SiteBuilder step 6.
    home: { _ref: pageDocId(siteId, 'home', 0), _type: 'reference' },
    about: { _ref: pageDocId(siteId, 'about', 0), _type: 'reference' },
    contact: { _ref: pageDocId(siteId, 'contact', 0), _type: 'reference' },
    services: bundle.services.map((_, i) => ({
      _key: `s${i}`,
      _ref: pageDocId(siteId, 'service', i),
      _type: 'reference',
    })),
    serviceAreas: bundle.service_areas.map((_, i) => ({
      _key: `sa${i}`,
      _ref: pageDocId(siteId, 'service_area', i),
      _type: 'reference',
    })),
    blogPosts: bundle.blog_posts.map((_, i) => ({
      _key: `b${i}`,
      _ref: pageDocId(siteId, 'blog', i),
      _type: 'reference',
    })),
    infoPages: bundle.info_pages.map((_, i) => ({
      _key: `i${i}`,
      _ref: pageDocId(siteId, 'info', i),
      _type: 'reference',
    })),
    generatedAt: bundle.generated_at,
  });

  const res = await tx.commit({ visibility: 'sync' });

  return {
    siteDocId: siteRef,
    pageDocIds: pageIds,
    transactionId: res.transactionId,
    pagesWritten: pageIds.length,
  };
}

function bundleSlug(bundle: ContentBundle): string {
  const ns = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${ns(bundle.niche)}-${ns(bundle.city)}-${bundle.state.toLowerCase()}`;
}
