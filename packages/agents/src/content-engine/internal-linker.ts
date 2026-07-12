import type { ContentBundle, Page } from '@leadlandlord/shared/types';

/**
 * Minimal shape of a keyword cluster the linker needs for pillar resolution.
 * Deliberately structural (not imported from content-engine/schema.ts) to
 * keep this module dependency-free and directly unit-testable — matches
 * `KeywordClusterInput` from schema.ts and the Sanity-sourced shape from
 * site-builder's read-clusters.ts.
 */
export interface ClusterPillarInput {
  cluster_key: string;
  /** cluster_key of the service cluster this cluster is a topical spoke of, or null/absent. */
  pillar_key?: string | null;
}

/**
 * Deterministic internal linker. Pure function — no I/O. Runs as a post-pass
 * after density-lint passes, before returning the bundle from execute().
 *
 * Injects Markdown links into page MDX bodies according to the caps defined
 * in build plan section 7.1 item 5, extended per the SEO audit (2026-07,
 * finding H5 / architect decision "footprint-mitigated"):
 *   home:          8-12 links (to all service pages + contact)
 *   service:       4-8 links (to other services + contact + 1-2 FAQ posts)
 *   blog:          2-4 links (to most-related service page)
 *   contact:       links back to all services
 *   service_area:  3-5 links — preferentially the most-related service
 *                  page(s) (keyword-overlap match), plus 1-2 nearby
 *                  service-area pages.
 *   faq_pages:     1-3 links — the single most-related service or info
 *                  page, with additional related pages as filler if the
 *                  quota isn't met naturally.
 *   info_pages:    2-4 links — related service pages, plus 0-1 related
 *                  blog/info page.
 *
 * Per-kind caps are deliberately non-uniform (not all reusing the blog's
 * 2-4 range) so a network of sites doesn't share one obviously-templated
 * link-count signature — see the architect's footprint-mitigation note in
 * docs/seo-aeo-geo-audit-2026-07.md.
 *
 * Hard constraints:
 *   - Never link a page to itself.
 *   - Never inject inside H1/H2/H3 (skip lines starting with #).
 *   - Never inject within the first 100 words of any page.
 *   - Don't double-link the same anchor phrase to the same target on one page.
 *   - Deterministic: no Date.now/Math.random — ranking ties break on the
 *     input array's original order.
 *
 * If quota not met by natural phrase matching, appends a "Related services"
 * bullet list at the end (service/FAQ/contact/service_area/info pages only).
 *
 * Pillar architecture (SEO audit M3): when `clusters` is supplied and a
 * blog/info/faq page's `cluster_key` has a `pillar_key` pointing at an
 * emitted service cluster, that service page becomes the page's FIRST
 * preferred link target (ahead of the generic relatedness ranking), and the
 * service page gains a reciprocal link back down to its highest-relatedness
 * spoke pages (0-2, within the existing service cap — never raised). Pages
 * without a resolvable pillar fall back to the pre-existing relatedness-only
 * behavior unchanged. Resolution happens here (not on the Page contract) —
 * `cluster_key` already round-trips onto pages via the existing content
 * engine contract, so no new field is needed on ContentBundle/Page.
 */

interface LinkTarget {
  slug: string;
  title: string;
  kind: string;
  /** page.primary_keyword, when present — used for kind-aware relatedness ranking. */
  primaryKeyword?: string;
  /** page.targeted_keywords[].phrase, when present — same purpose as primaryKeyword. */
  keywords?: string[];
  /** page.cluster_key, when present — used to resolve pillar/spoke relationships. */
  clusterKey?: string;
}

/**
 * Returns a new ContentBundle with internal links injected. Does not mutate
 * the input bundle.
 *
 * @param clusters Optional keyword-cluster inputs (same list passed into
 *   Content Engine) carrying `pillar_key` per cluster. When provided, faq/
 *   info/blog pages whose cluster resolves to a service pillar link to that
 *   service first, and the service page links back to its spokes. Omit (or
 *   pass an empty array) to get the pre-pillar behavior unchanged.
 */
export function injectInternalLinks(
  bundle: ContentBundle,
  clusters: readonly ClusterPillarInput[] = [],
): ContentBundle {
  // Build link target list from the bundle
  const serviceTargets: LinkTarget[] = (bundle.services ?? []).map(toLinkTarget('service'));
  const contactTarget: LinkTarget | null = bundle.contact
    ? { slug: bundle.contact.slug, title: bundle.contact.title, kind: 'contact' }
    : null;
  const blogTargets: LinkTarget[] = (bundle.blog_posts ?? []).map(toLinkTarget('blog'));
  const serviceAreaTargets: LinkTarget[] = (bundle.service_areas ?? []).map(toLinkTarget('service_area'));
  const infoTargets: LinkTarget[] = (bundle.info_pages ?? []).map(toLinkTarget('info'));
  const faqTargets: LinkTarget[] = (bundle.faq_pages ?? []).map(toLinkTarget('faq'));
  const businessName = bundle.business_name;

  const pillar = resolvePillarLinking(clusters, serviceTargets, [
    ...blogTargets,
    ...infoTargets,
    ...faqTargets,
  ]);

  return {
    ...bundle,
    home: bundle.home
      ? {
          ...bundle.home,
          mdx: linkHomePage(bundle.home.mdx, bundle.home.slug, serviceTargets, contactTarget, businessName),
        }
      : bundle.home,
    services: (bundle.services ?? []).map((page) => ({
      ...page,
      mdx: linkServicePage(
        page.mdx,
        toLinkTarget('service')(page),
        serviceTargets,
        contactTarget,
        blogTargets,
        pillar.spokesByServiceSlug.get(page.slug) ?? [],
        businessName,
      ),
    })),
    blog_posts: (bundle.blog_posts ?? []).map((page) => ({
      ...page,
      mdx: linkBlogPage(
        page.mdx,
        page.slug,
        serviceTargets,
        pillar.pillarTargetBySlug.get(page.slug) ?? null,
        businessName,
      ),
    })),
    contact: bundle.contact
      ? {
          ...bundle.contact,
          mdx: linkContactPage(bundle.contact.mdx, bundle.contact.slug, serviceTargets, businessName),
        }
      : bundle.contact,
    service_areas: (bundle.service_areas ?? []).map((page) => ({
      ...page,
      mdx: linkServiceAreaPage(
        page.mdx,
        toLinkTarget('service_area')(page),
        serviceTargets,
        serviceAreaTargets,
        businessName,
      ),
    })),
    faq_pages: (bundle.faq_pages ?? []).map((page) => ({
      ...page,
      mdx: linkFaqPage(
        page.mdx,
        toLinkTarget('faq')(page),
        serviceTargets,
        infoTargets,
        pillar.pillarTargetBySlug.get(page.slug) ?? null,
        businessName,
      ),
    })),
    info_pages: (bundle.info_pages ?? []).map((page) => ({
      ...page,
      mdx: linkInfoPage(
        page.mdx,
        toLinkTarget('info')(page),
        serviceTargets,
        [...infoTargets, ...blogTargets],
        pillar.pillarTargetBySlug.get(page.slug) ?? null,
        businessName,
      ),
    })),
  };
}

/**
 * Build a LinkTarget from a Page, carrying keyword signal (primary_keyword +
 * targeted_keywords phrases) forward for kind-aware relatedness ranking.
 */
function toLinkTarget(kind: string) {
  return (p: Page): LinkTarget => ({
    slug: p.slug,
    title: p.title,
    kind,
    primaryKeyword: p.primary_keyword,
    keywords: (p.targeted_keywords ?? []).map((k) => k.phrase),
    clusterKey: p.cluster_key,
  });
}

// ---------------------------------------------------------------------------
// Pillar/spoke resolution (SEO audit M3)
// ---------------------------------------------------------------------------

interface PillarLinking {
  /** spoke page slug -> its pillar service LinkTarget. */
  pillarTargetBySlug: Map<string, LinkTarget>;
  /** service page slug -> its spoke LinkTargets (unranked; callers rank by relatedness). */
  spokesByServiceSlug: Map<string, LinkTarget[]>;
}

/**
 * Resolves cluster-level `pillar_key` references into concrete LinkTargets.
 * Defensive by design — a `pillar_key` that doesn't resolve to an emitted
 * service page (already validated upstream by keyword-planner's
 * resolvePillarKeys(), but re-checked here since this module has no
 * guarantee about caller data) is silently dropped rather than throwing.
 */
function resolvePillarLinking(
  clusters: readonly ClusterPillarInput[],
  services: LinkTarget[],
  spokeCandidates: LinkTarget[],
): PillarLinking {
  const pillarTargetBySlug = new Map<string, LinkTarget>();
  const spokesByServiceSlug = new Map<string, LinkTarget[]>();
  if (clusters.length === 0) return { pillarTargetBySlug, spokesByServiceSlug };

  const pillarKeyByClusterKey = new Map<string, string>();
  for (const c of clusters) {
    if (c.pillar_key) pillarKeyByClusterKey.set(c.cluster_key, c.pillar_key);
  }
  const serviceByClusterKey = new Map<string, LinkTarget>();
  for (const s of services) {
    if (s.clusterKey) serviceByClusterKey.set(s.clusterKey, s);
  }

  for (const spoke of spokeCandidates) {
    if (!spoke.clusterKey) continue;
    const pillarKey = pillarKeyByClusterKey.get(spoke.clusterKey);
    if (!pillarKey) continue;
    const service = serviceByClusterKey.get(pillarKey);
    if (!service) continue;
    pillarTargetBySlug.set(spoke.slug, service);
    const existing = spokesByServiceSlug.get(service.slug);
    if (existing) existing.push(spoke);
    else spokesByServiceSlug.set(service.slug, [spoke]);
  }

  return { pillarTargetBySlug, spokesByServiceSlug };
}

// ---------------------------------------------------------------------------
// Per-page linkers
// ---------------------------------------------------------------------------

function linkHomePage(
  mdx: string,
  selfSlug: string,
  services: LinkTarget[],
  contact: LinkTarget | null,
  businessName: string,
): string {
  const targets = [...services, ...(contact ? [contact] : [])].filter(
    (t) => t.slug !== selfSlug,
  );
  return injectLinks(mdx, selfSlug, targets, { minLinks: 8, maxLinks: 12, businessName });
}

/**
 * Service pages: 4-8 links, unchanged cap. Pillar architecture adds up to 2
 * reciprocal links down to this service's highest-relatedness spoke pages
 * (faq/info/blog clusters whose pillar_key points here) — inserted after
 * sibling services/contact so the existing hub-spoke priority order is
 * preserved, before the existing generic topBlogs filler.
 */
function linkServicePage(
  mdx: string,
  self: LinkTarget,
  services: LinkTarget[],
  contact: LinkTarget | null,
  blogs: LinkTarget[],
  spokes: LinkTarget[],
  businessName: string,
): string {
  const otherServices = services.filter((t) => t.slug !== self.slug);
  const rankedSpokes = sortByRelatedness(self, spokes).slice(0, 2);
  const spokeSlugsUsed = new Set(rankedSpokes.map((s) => s.slug));
  const topBlogs = blogs.filter((b) => !spokeSlugsUsed.has(b.slug)).slice(0, 2);
  const targets = [
    ...otherServices,
    ...(contact ? [contact] : []),
    ...rankedSpokes,
    ...topBlogs,
  ];
  return injectLinks(mdx, self.slug, targets, { minLinks: 4, maxLinks: 8, businessName });
}

/**
 * Blog pages: 2-4 links. When the cluster has a pillar service, that service
 * is the FIRST preferred target (replacing the generic top-ranked service);
 * the pre-existing single-service fallback fills remaining quota otherwise.
 */
function linkBlogPage(
  mdx: string,
  selfSlug: string,
  services: LinkTarget[],
  pillarTarget: LinkTarget | null,
  businessName: string,
): string {
  const others = services.filter((t) => t.slug !== selfSlug);
  const targets = pillarTarget
    ? [pillarTarget, ...others.filter((t) => t.slug !== pillarTarget.slug).slice(0, 1)]
    : others.slice(0, 1);
  return injectLinks(mdx, selfSlug, targets, { minLinks: 2, maxLinks: 4, businessName });
}

function linkContactPage(
  mdx: string,
  selfSlug: string,
  services: LinkTarget[],
  businessName: string,
): string {
  const targets = services.filter((t) => t.slug !== selfSlug);
  return injectLinks(mdx, selfSlug, targets, { minLinks: targets.length, maxLinks: targets.length, businessName });
}

/**
 * service_area pages: 3-5 links. Preferentially the most-related service
 * page(s) (keyword-overlap match against self), plus 1-2 nearby
 * service-area pages. "Nearby" has no geo-distance data in the bundle, so
 * array order (as planned/emitted) is used as a deterministic proxy.
 */
function linkServiceAreaPage(
  mdx: string,
  self: LinkTarget,
  services: LinkTarget[],
  serviceAreas: LinkTarget[],
  businessName: string,
): string {
  const rankedServices = sortByRelatedness(self, services.filter((t) => t.slug !== self.slug));
  const otherAreas = serviceAreas.filter((t) => t.slug !== self.slug);
  // Reserve the top 2 relevance slots for services, then interleave 1-2
  // nearby areas, then fall back to remaining services as filler so the
  // 3-5 cap is still reachable when few areas/services score well.
  const topServices = rankedServices.slice(0, 2);
  const nearbyAreas = otherAreas.slice(0, 2);
  const fillerServices = rankedServices.slice(2);
  const targets = [...topServices, ...nearbyAreas, ...fillerServices];
  return injectLinks(mdx, self.slug, targets, { minLinks: 3, maxLinks: 5, businessName });
}

/**
 * faq_pages: 1-3 links. When the cluster has a pillar service, that service
 * is the FIRST preferred target (replacing the generic top-ranked
 * service/info page); the pre-existing relatedness ranking over
 * services+info fills remaining quota, with related pages as filler only if
 * quota isn't hit naturally.
 */
function linkFaqPage(
  mdx: string,
  self: LinkTarget,
  services: LinkTarget[],
  infoPages: LinkTarget[],
  pillarTarget: LinkTarget | null,
  businessName: string,
): string {
  const candidates = [...services, ...infoPages].filter((t) => t.slug !== self.slug);
  const ranked = sortByRelatedness(self, candidates);
  const targets = pillarTarget
    ? [pillarTarget, ...ranked.filter((t) => t.slug !== pillarTarget.slug)]
    : ranked;
  return injectLinks(mdx, self.slug, targets, { minLinks: 1, maxLinks: 3, businessName });
}

/**
 * info_pages: 2-4 links. When the cluster has a pillar service, that service
 * is the FIRST preferred target (replacing the generic top-ranked service);
 * the pre-existing service-relatedness ranking plus 0-1 related blog/info
 * page fills remaining quota.
 */
function linkInfoPage(
  mdx: string,
  self: LinkTarget,
  services: LinkTarget[],
  otherInfoAndBlog: LinkTarget[],
  pillarTarget: LinkTarget | null,
  businessName: string,
): string {
  const rankedServices = sortByRelatedness(self, services.filter((t) => t.slug !== self.slug));
  const rankedOther = sortByRelatedness(
    self,
    otherInfoAndBlog.filter((t) => t.slug !== self.slug),
  ).slice(0, 1);
  const orderedServices = pillarTarget
    ? [pillarTarget, ...rankedServices.filter((t) => t.slug !== pillarTarget.slug)]
    : rankedServices;
  const targets = [...orderedServices, ...rankedOther];
  return injectLinks(mdx, self.slug, targets, { minLinks: 2, maxLinks: 4, businessName });
}

// ---------------------------------------------------------------------------
// Keyword-overlap relatedness ranking (kind-aware target selection)
// ---------------------------------------------------------------------------

// Generic words stripped before scoring so "cleaning services near you" vs.
// "gutter cleaning services" doesn't over-match on filler terms.
const GENERIC_SIGNAL_WORDS = new Set([
  'the', 'and', 'for', 'with', 'your', 'our', 'you', 'near', 'me', 'in',
  'a', 'an', 'of', 'to', 'best', 'top', 'get', 'services', 'service',
  'today', 'free', 'call', 'local',
]);

function extractSignalWords(target: LinkTarget): Set<string> {
  const raw = [target.primaryKeyword ?? '', ...(target.keywords ?? []), target.title]
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');
  return new Set(
    raw
      .split(/\s+/)
      .filter((w) => w.length > 2 && !GENERIC_SIGNAL_WORDS.has(w)),
  );
}

/**
 * Score relatedness between two targets by counting shared signal words
 * drawn from primary_keyword + targeted_keywords + title. Higher is more
 * related. Pure, deterministic — no randomness.
 */
function relatednessScore(a: LinkTarget, b: LinkTarget): number {
  const wa = extractSignalWords(a);
  const wb = extractSignalWords(b);
  let overlap = 0;
  for (const w of wa) {
    if (wb.has(w)) overlap++;
  }
  return overlap;
}

/**
 * Sort candidates by relatedness to `self`, descending. Ties preserve the
 * original candidate order (stable sort) for determinism.
 */
function sortByRelatedness(self: LinkTarget, candidates: LinkTarget[]): LinkTarget[] {
  return candidates
    .map((c, index) => ({ c, index, score: relatednessScore(self, c) }))
    .sort((x, y) => y.score - x.score || x.index - y.index)
    .map((x) => x.c);
}

// ---------------------------------------------------------------------------
// Core injection engine
// ---------------------------------------------------------------------------

interface InjectOptions {
  minLinks: number;
  maxLinks: number;
  businessName: string;
}

function injectLinks(
  mdx: string,
  selfSlug: string,
  targets: LinkTarget[],
  opts: InjectOptions,
): string {
  if (targets.length === 0) return mdx;

  const paragraphs = mdx.split('\n\n');
  const wordsSoFar = { count: 0 };
  const usedAnchors = new Set<string>(); // anchor text → already linked
  const usedTargets = new Set<string>(); // slug → already has a link on this page
  let linksInjected = 0;

  const result = paragraphs.map((para) => {
    // Count words in this paragraph toward the 100-word skip zone
    const paraWords = extractWordCount(para);
    const wasBeforeZone = wordsSoFar.count < 100;
    wordsSoFar.count += paraWords;

    // Skip heading lines and paragraphs in the first-100-words zone
    if (isHeadingLine(para) || wasBeforeZone) return para;

    // Try to inject links for targets not yet linked
    let modified = para;
    for (const target of targets) {
      if (linksInjected >= opts.maxLinks) break;
      if (usedTargets.has(target.slug)) continue;

      const { anchor, linked } = tryInjectLink(modified, target, opts.businessName, usedAnchors);
      if (linked !== null) {
        modified = linked;
        usedAnchors.add(anchor);
        usedTargets.add(target.slug);
        linksInjected++;
      }
    }
    return modified;
  });

  let finalMdx = result.join('\n\n');

  // If quota not met, append a Related services bullet list
  if (linksInjected < opts.minLinks) {
    const remaining = targets
      .filter((t) => !usedTargets.has(t.slug))
      .slice(0, opts.maxLinks - linksInjected);
    if (remaining.length > 0) {
      const bullets = remaining
        .map((t) => `- [${anchorText(t, opts.businessName, 0)}](${t.slug})`)
        .join('\n');
      finalMdx = `${finalMdx}\n\n${bullets}`;
    }
  }

  return finalMdx;
}

/**
 * Attempt to replace a phrase in `para` with a markdown link to `target`.
 * Returns the modified paragraph and anchor text if successful, null if no
 * suitable phrase was found.
 */
function tryInjectLink(
  para: string,
  target: LinkTarget,
  businessName: string,
  usedAnchors: Set<string>,
): { anchor: string; linked: string | null } {
  // Try three anchor variants in priority order
  const variants = buildAnchorVariants(target, businessName);
  for (const anchor of variants) {
    if (usedAnchors.has(anchor)) continue;
    // Case-insensitive search; replace first occurrence only
    const idx = para.toLowerCase().indexOf(anchor.toLowerCase());
    if (idx === -1) continue;
    // Don't inject inside an existing markdown link: check for [ before anchor
    if (para[idx - 1] === '[' || para.slice(0, idx).includes(`](${target.slug})`)) continue;

    const original = para.slice(idx, idx + anchor.length);
    const linked = `${para.slice(0, idx)}[${original}](${target.slug})${para.slice(idx + anchor.length)}`;
    return { anchor, linked };
  }
  return { anchor: '', linked: null };
}

/**
 * Three anchor variants per target:
 *   0: bare service name (e.g. "window cleaning")
 *   1: branded (e.g. "Mike's Window Cleaning's window cleaning")
 *   2: phrasal-implicit (e.g. "our window cleaning team")
 *
 * Rotate by index so repeated injection uses different patterns.
 */
function buildAnchorVariants(target: LinkTarget, businessName: string): string[] {
  const name = target.title.replace(/\s*[-–—|·].*$/, '').trim(); // strip " | City" etc.
  return [
    name,
    `${businessName}'s ${name.toLowerCase()}`,
    `our ${name.toLowerCase()}`,
  ];
}

function anchorText(target: LinkTarget, businessName: string, variant: 0 | 1 | 2): string {
  return buildAnchorVariants(target, businessName)[variant] ?? target.title;
}

function isHeadingLine(para: string): boolean {
  return /^#{1,3}\s/.test(para.trim());
}

function extractWordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}
