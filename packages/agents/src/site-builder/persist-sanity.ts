import type { ContentBundle, Page } from '@leadlandlord/shared/types';
import {
  createWriteClient,
  siteDocId,
  pageDocId,
  themeDocId,
  type PageKind,
} from '@leadlandlord/integrations/sanity';
import { keywordClusterDocId } from '@leadlandlord/sanity-schema';

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
 * Create a minimal Sanity `site` doc up front so downstream agents can
 * write docs that reference it without hitting "non-existent document"
 * mutation errors.
 *
 * Why this exists: Keyword Planner runs early in the site-builder pipeline
 * and persists `keywordCluster` docs whose `site` field is a reference to
 * `site-${siteId}`. Sanity rejects mutations whose references point at
 * non-existent docs (referential integrity). The full `writeSiteToSanity`
 * at the end of site-builder createOrReplaces this stub with the populated
 * version — references stay valid because the `_id` is identical.
 *
 * Idempotent: safe to call multiple times. Stub fields (niche/city/state/
 * slug) are preserved on the second call; the final populated overwrite
 * replaces them with their real values from the content bundle.
 */
export async function ensureSiteDocStub(
  siteId: string,
  basics: { niche: string; city: string; state: string },
  opts: WriteSiteToSanityOptions = {},
): Promise<void> {
  const client = createWriteClient(opts.dataset ? { dataset: opts.dataset } : {});
  // createIfNotExists, not createOrReplace — we MUST NOT clobber a fully-
  // populated site doc on a re-run (e.g. when site-builder is re-targeted).
  // The final writeSiteToSanity at the end of site-builder uses
  // createOrReplace to update everything. Between the two, downstream agents
  // (keyword-planner) can safely reference `site-${siteId}`.
  const stubSlug = `${basics.niche}-${basics.city}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  await client.createIfNotExists({
    _id: siteDocId(siteId),
    _type: 'site',
    siteId,
    slug: { _type: 'slug', current: stubSlug },
    niche: basics.niche,
    city: basics.city,
    state: basics.state.toUpperCase(),
    domains: [],
    robotsDisallow: true,
    trustSignals: [],
    nearbyCities: [],
  });
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
      // Keyword targeting (when content engine declared a cluster).
      primaryKeyword: ref.page.primary_keyword,
      targetedKeywords: (ref.page.targeted_keywords ?? []).map((k, i) => ({
        _key: `tk${i}`,
        phrase: k.phrase,
        role: k.role,
        clusterKey: k.cluster_key,
      })),
    });
  }

  // Update keywordCluster docs: stamp targetPage + flip status to 'covered'
  // (or 'gap' for unclaimed clusters). We patch instead of createOrReplace
  // because keyword-planner owns the rest of the cluster doc — we only update
  // these three fields here.
  const claimedClusters = new Map<string, string>(); // cluster_key → page _id
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i]!;
    const ck = r.page.cluster_key;
    if (ck) claimedClusters.set(ck, pageIds[i]!);
  }
  for (const [clusterKey, pageId] of claimedClusters.entries()) {
    tx.patch(keywordClusterDocId(siteId, clusterKey), (p) =>
      p
        .set({
          targetPage: { _ref: pageId, _type: 'reference' },
          status: 'covered',
        }),
    );
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
