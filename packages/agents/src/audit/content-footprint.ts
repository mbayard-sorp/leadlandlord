/**
 * audit/content-footprint.ts
 *
 * DB/Sanity-backed loader for the content-similarity checks in
 * `./content-similarity.ts` (BL-021). Mirrors the pure/wrapper split of
 * `./cross-link-footprint.ts`: this file does the IO (member lookup via
 * Postgres `site_network_memberships` + read-only Sanity fetch per
 * network-linker conventions — `createReadClient()` + `site._ref ==`), the
 * math lives in the pure module.
 *
 * `businessName`/`city` come from the Sanity `site` doc (not Postgres
 * `sites`, which has no business-name column — that lives on `tenants`,
 * one-to-one-ish but not guaranteed present pre-signing; the Sanity site doc
 * is the field content-engine actually stamps into every bundle/page).
 *
 * Consumed by `apps/operator/app/operator/networks/[id]/page.tsx` alongside
 * `scoreNetworkFootprint` in the existing "Footprint risk" section.
 */

import { getDb, siteNetworkMemberships, eq } from '@leadlandlord/db';
import { createReadClient, siteDocId } from '@leadlandlord/integrations/sanity';
import {
  analyzeNetworkFaqOverlap,
  analyzeNetworkLinkPatternSimilarity,
  aggregateSiteLinkSignature,
  extractPageLinkSignature,
  type FaqOverlapPairResult,
  type LinkSignatureComparison,
  type SiteFaqSet,
} from './content-similarity';

export interface ContentFootprintResult {
  faqOverlaps: FaqOverlapPairResult[];
  linkPatternSimilarities: LinkSignatureComparison[];
}

interface SanityPageRow {
  slug: string;
  kind: string;
  mdx: string | null;
  faqs: Array<{ q: string; a: string }> | null;
}

interface SanitySiteDoc {
  businessName: string | null;
  city: string | null;
}

const PAGES_QUERY = `*[_type == "page" && site._ref == $siteRef]{ slug, kind, mdx, faqs }`;
const SITE_DOC_QUERY = `*[_id == $siteRef][0]{ businessName, city }`;

/**
 * Load every member site's content (page mdx + faqs) for a network and run
 * both content-similarity checks. Read-only — never writes to Sanity or
 * Postgres. A network with < 2 members trivially returns empty results (both
 * checks are pairwise).
 */
export async function scoreNetworkContentFootprint(
  networkId: string,
): Promise<ContentFootprintResult> {
  const db = getDb();

  const members = await db
    .select({ siteId: siteNetworkMemberships.siteId })
    .from(siteNetworkMemberships)
    .where(eq(siteNetworkMemberships.networkId, networkId));

  const memberSiteIds = members.map((m: { siteId: string }) => m.siteId);
  if (memberSiteIds.length < 2) {
    return { faqOverlaps: [], linkPatternSimilarities: [] };
  }

  const sanity = createReadClient();

  const siteDocsBySite = await Promise.all(
    memberSiteIds.map(async (siteId) => {
      const siteRef = siteDocId(siteId);
      try {
        const doc = await sanity.fetch<SanitySiteDoc | null>(SITE_DOC_QUERY, { siteRef });
        return { siteId, businessName: doc?.businessName ?? '', city: doc?.city ?? undefined };
      } catch {
        return { siteId, businessName: '', city: undefined as string | undefined };
      }
    }),
  );
  const siteInfoBySite = Object.fromEntries(siteDocsBySite.map((s) => [s.siteId, s]));

  const pagesBySite = await Promise.all(
    memberSiteIds.map(async (siteId) => {
      const siteRef = siteDocId(siteId);
      try {
        const rows = await sanity.fetch<SanityPageRow[]>(PAGES_QUERY, { siteRef });
        return { siteId, rows: rows ?? [] };
      } catch {
        // Read-only best-effort: a Sanity hiccup for one site shouldn't fail
        // the whole network review — it just contributes no data.
        return { siteId, rows: [] as SanityPageRow[] };
      }
    }),
  );

  // ── FAQ overlap ──────────────────────────────────────────────────────
  const faqSets: SiteFaqSet[] = pagesBySite.map(({ siteId, rows }) => ({
    siteId,
    city: siteInfoBySite[siteId]?.city,
    faqs: rows.flatMap((r) => r.faqs ?? []),
  }));
  const faqOverlaps = analyzeNetworkFaqOverlap(faqSets);

  // ── Link-pattern similarity ──────────────────────────────────────────
  const linkSignatureSites = pagesBySite.map(({ siteId, rows }) => {
    const businessName = siteInfoBySite[siteId]?.businessName ?? '';
    const targetKindBySlug: Record<string, string> = Object.fromEntries(
      rows.filter((r) => r.slug).map((r) => [r.slug, r.kind]),
    );
    const pageSignatures = rows
      .filter((r) => r.mdx && r.slug)
      .map((r) =>
        extractPageLinkSignature({
          slug: r.slug,
          pageKind: r.kind,
          mdx: r.mdx ?? '',
          businessName,
          targetKindBySlug,
        }),
      );
    return { siteId, signature: aggregateSiteLinkSignature(pageSignatures) };
  });
  const linkPatternSimilarities = analyzeNetworkLinkPatternSimilarity(linkSignatureSites);

  return { faqOverlaps, linkPatternSimilarities };
}
