import { createReadClient } from '@leadlandlord/sanity-schema';
import type { ClusterIntent, KeywordRole } from '@leadlandlord/sanity-schema';

/**
 * Shape passed from site-builder → content-engine. Trimmed down from the
 * full Sanity doc — Content Engine doesn't need fetchedAt, status, etc.
 */
export interface KeywordClusterInput {
  cluster_key: string;
  page_kind: 'home' | 'service' | 'service_area' | 'blog' | 'info';
  intent: ClusterIntent;
  primary_keyword: string;
  supporting_keywords: string[];
  search_volume: number;
  total_volume: number;
}

interface SanityCluster {
  clusterKey: string;
  pageKind: 'home' | 'service' | 'service_area' | 'blog' | 'info';
  intent: ClusterIntent;
  primaryKeyword: string;
  totalVolume: number;
  keywords: Array<{
    phrase: string;
    role: KeywordRole;
    searchVolume: number;
  }>;
}

const QUERY = `*[_type == "keywordCluster" && siteId == $siteId && status != "retired"]{
  clusterKey, pageKind, intent, primaryKeyword, totalVolume,
  keywords[]{ phrase, role, searchVolume }
}`;

/**
 * Fetch all non-retired keyword clusters for a site, return in the shape
 * Content Engine consumes. Returns empty array when no clusters exist
 * (backwards-compat — Content Engine handles this gracefully).
 */
export async function loadKeywordClustersForSite(siteId: string): Promise<KeywordClusterInput[]> {
  const client = createReadClient({ useCdn: false });
  const rows = await client.fetch<SanityCluster[]>(QUERY, { siteId });
  return rows.map((row) => {
    const primaryKeyword = row.primaryKeyword.toLowerCase();
    const supporting = (row.keywords ?? [])
      .filter((k) => k.role !== 'primary')
      .map((k) => k.phrase);
    const primaryEntry = (row.keywords ?? []).find((k) => k.role === 'primary');
    return {
      cluster_key: row.clusterKey,
      page_kind: row.pageKind,
      intent: row.intent,
      primary_keyword: primaryKeyword,
      supporting_keywords: supporting,
      search_volume: primaryEntry?.searchVolume ?? 0,
      total_volume: row.totalVolume ?? 0,
    };
  });
}
