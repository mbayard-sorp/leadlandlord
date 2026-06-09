import type { ContentBundle, Page } from '@leadlandlord/shared/types';
import {
  createWriteClient,
  siteDocId,
  pageDocId,
  themeDocId,
  type PageKind,
} from '@leadlandlord/integrations/sanity';
import { keywordClusterDocId } from '@leadlandlord/sanity-schema/ids';

export interface WriteSiteToSanityOptions {
  /** Override Sanity dataset (defaults to env). Used by dry-run for `development`. */
  dataset?: string;
  /**
   * Agent-picked color palette for the site (see `pick-palette.ts`). Written
   * only when the site doc has no palette yet — an operator-set value already
   * on the doc is preserved across rebuilds. Defaults to 'default'.
   */
  colorPalette?: 'default' | 'alt1' | 'alt2';
  /**
   * Build-derived geo for the LocalBusiness `geo` (GeoCoordinates) JSON-LD.
   * Both must be present to write. Build-derived values are fine to overwrite
   * on rebuild; an operator override on the existing doc still wins (see
   * `writeSiteToSanity`).
   */
  geo?: { latitude: number; longitude: number } | null;
  /**
   * Pre-generated per-page article image asset refs, keyed by page doc _id.
   * Generated best-effort in site-builder BEFORE this write (mirrors the hero
   * image upload) so the page createOrReplace can attach `articleImage`
   * inline. Missing/absent entries leave `articleImage` unset (routes fall
   * back to OG/hero).
   */
  articleImageAssetIds?: Map<string, string>;
  /**
   * Timestamp (ISO) stamped onto every page's `dateModified` so Article
   * JSON-LD reflects this (re)generation. Defaults to now when absent.
   */
  dateModified?: string;
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
  /** Palette actually persisted (operator override wins over the agent pick). */
  colorPalette: 'default' | 'alt1' | 'alt2';
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
  // Include state so the stub slug matches the final bundleSlug() exactly.
  // Without this the stub gets created as `<niche>-<city>` and the final
  // overwrite at writeSiteToSanity uses `<niche>-<city>-<state>` — any
  // mid-build URL bookmark (preview link in the operator UI) drifts.
  const stubSlug = `${basics.niche}-${basics.city}-${basics.state}`
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

  // Resolve the palette before the createOrReplace (which clobbers the whole
  // doc). An operator may have swapped the palette in Studio after the first
  // build — that value lives on the existing doc and must win over the agent
  // pick so rebuilds don't reset their choice.
  const existingSite = await client.getDocument(siteDocId(siteId));
  const resolvedPalette =
    (existingSite?.colorPalette as 'default' | 'alt1' | 'alt2' | undefined) ??
    opts.colorPalette ??
    'default';

  // Preserve operator-entered, manual-only fields across regen. The site doc is
  // written with createOrReplace, which drops any field not re-supplied — so a
  // re-target/regenerate would otherwise wipe a hand-entered video. The content
  // engine never sets these, so the existing doc value always wins.
  const videoUrl =
    (bundle.video_url ?? (existingSite?.videoUrl as string | undefined)) || undefined;
  const videoDescription =
    (bundle.video_description ?? (existingSite?.videoDescription as string | undefined)) ||
    undefined;

  // sameAs + lat/lng are OPERATOR-ENTERED in Studio (real GBP / social URLs,
  // or a hand-corrected coordinate). createOrReplace would otherwise wipe them
  // on every rebuild — same carry-forward as videoUrl above. The content engine
  // never authors sameAs, so any value on the existing doc always wins. For
  // geo: build-derived coordinates are an acceptable default, but an operator
  // override on the existing doc takes precedence over the freshly-derived one.
  const existingSameAs = Array.isArray(existingSite?.sameAs)
    ? (existingSite!.sameAs as string[])
    : undefined;
  const sameAs =
    existingSameAs && existingSameAs.length > 0
      ? existingSameAs
      : bundle.same_as && bundle.same_as.length > 0
        ? bundle.same_as
        : undefined;
  const existingLat = existingSite?.latitude as number | undefined;
  const existingLng = existingSite?.longitude as number | undefined;
  const latitude =
    typeof existingLat === 'number'
      ? existingLat
      : opts.geo?.latitude ?? bundle.latitude;
  const longitude =
    typeof existingLng === 'number'
      ? existingLng
      : opts.geo?.longitude ?? bundle.longitude;

  // Stamp page dateModified to this (re)generation so Article JSON-LD freshness
  // is real. Build-time default is now; callers may pass an explicit timestamp.
  const dateModified = opts.dateModified ?? new Date().toISOString();

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
    ...bundle.faq_pages.map((p, i) => ({ kind: 'faq' as PageKind, index: i, page: p })),
  ];

  const siteRef = siteDocId(siteId);
  const tx = client.transaction();

  // Pages first — referenced by the site doc.
  const pageIds: string[] = [];
  for (const ref of refs) {
    const id = pageDocId(siteId, ref.kind, ref.index);
    pageIds.push(id);
    // Per-page article image (blog/info only) — generated best-effort upstream
    // and passed in by asset _id. Absent → leave articleImage unset so the
    // route falls back to OG/hero.
    const articleAssetId = opts.articleImageAssetIds?.get(id);
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
      articleImage: articleAssetId
        ? { _type: 'image', asset: { _type: 'reference', _ref: articleAssetId } }
        : undefined,
      // Article `dateModified` — stamped to this generation. Prefer a per-page
      // value the pipeline set on the bundle, else the build-wide timestamp.
      dateModified: ref.page.date_modified ?? dateModified,
      // Keyword targeting (when content engine declared a cluster).
      primaryKeyword: ref.page.primary_keyword,
      faqs: (ref.page.faqs ?? []).map((f, i) => ({
        _key: `faq${i}`,
        q: f.q,
        a: f.a,
      })),
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
    colorPalette: resolvedPalette,
    domains: [], // populated by the operator dashboard via Vercel Domains API
    robotsDisallow: true, // default during warming — operator flips when going live
    trustSignals: bundle.trust_signals ?? [],
    nearbyCities: bundle.nearby_cities ?? [],
    // Geo (GeoCoordinates) — build-derived centroid, operator override wins.
    // Only set when both are present (site-host requires both to emit `geo`).
    latitude: typeof latitude === 'number' ? latitude : undefined,
    longitude: typeof longitude === 'number' ? longitude : undefined,
    // sameAs — operator-entered real profile URLs, carried forward across
    // rebuilds (see resolution above). Undefined leaves the field untouched.
    sameAs,
    neighborhoods: (bundle.neighborhoods ?? []).map((n, i) => ({
      _key: `n${i}`,
      name: n.name,
      googleMapsUrl: n.google_maps_url,
    })),
    heroImagePrompt: bundle.hero_image_prompt ?? undefined,
    // heroImage asset is patched separately after generation — see SiteBuilder step 6.
    videoUrl,
    videoDescription,
    longformBody: bundle.longform_body ?? undefined,
    longformGeneratedAt: bundle.longform_generated_at ?? undefined,
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
    faqPages: bundle.faq_pages.map((_, i) => ({
      _key: `f${i}`,
      _ref: pageDocId(siteId, 'faq', i),
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
    colorPalette: resolvedPalette,
  };
}

/**
 * Patch ONLY the long-form intro fields on an existing site doc. Used by the
 * Site Builder's `longform_only` backfill path so a regeneration leaves every
 * page doc and the manual video fields untouched.
 */
export async function patchLongformInSanity(
  siteId: string,
  longformBody: string,
  generatedAt: string,
  opts: WriteSiteToSanityOptions = {},
): Promise<{ siteDocId: string; transactionId: string }> {
  const client = createWriteClient(opts.dataset ? { dataset: opts.dataset } : {});
  const siteRef = siteDocId(siteId);
  const res = await client
    .patch(siteRef)
    .set({ longformBody, longformGeneratedAt: generatedAt })
    .commit({ visibility: 'sync' });
  return { siteDocId: siteRef, transactionId: res._rev ?? '' };
}

function bundleSlug(bundle: ContentBundle): string {
  const ns = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${ns(bundle.niche)}-${ns(bundle.city)}-${bundle.state.toLowerCase()}`;
}
