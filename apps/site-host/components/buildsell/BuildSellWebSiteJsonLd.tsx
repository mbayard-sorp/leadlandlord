import { buildWebSiteNode } from './buildsell-jsonld';
import type { BuildSellSite } from '@/lib/sanity';

interface BuildSellWebSiteJsonLdProps {
  site: BuildSellSite;
  /** Canonical public URL for this spec site render, e.g. https://example.com/buildsell/abc-plumbing-phoenix-az-abc123 */
  url: string;
}

/**
 * WebSite JSON-LD node for a Build & Sell spec site, mirroring
 * components/shared/WebSiteJsonLd.tsx. publisher cross-references the
 * LocalBusiness @id emitted by BuildSellLocalBusinessJsonLd, keyed off the
 * request origin so it matches on both the /buildsell/{slug} path route and
 * a custom-domain root.
 */
export function BuildSellWebSiteJsonLd({ site, url }: BuildSellWebSiteJsonLdProps) {
  const origin = new URL(url).origin;
  const ld = buildWebSiteNode(site, origin);
  if (!ld) return null;

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
    />
  );
}
