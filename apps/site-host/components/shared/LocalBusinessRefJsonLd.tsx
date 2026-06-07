import type { Bundle } from '../../lib/content';
import { buildLocalBusinessRef } from './local-business-schema';

interface Props {
  bundle: Bundle;
  /** Absolute canonical URL of the site root, e.g. "https://example.com". */
  url: string;
}

/**
 * Site-wide LocalBusiness node, mounted once in app/layout.tsx so the
 * `#localbusiness` entity is DEFINED on every page — not just the homepage.
 *
 * Why: WebSiteJsonLd (also in layout) references `publisher -> #localbusiness`
 * by @id, and the home variant emits the full LocalBusiness node. But Google
 * evaluates each page independently and won't resolve a cross-page @id, so on
 * /about, /services/*, /blog/*, etc. that publisher reference dangled. This
 * minimal node resolves it everywhere.
 *
 * On the homepage this shares the same @id with the variant's richer node
 * (telephone, hours, reviews, aggregateRating) — Google merges same-@id nodes,
 * so the homepage gets the union and subpages get this solid base. Kept
 * intentionally light (no tracking-number lookup) so it adds no per-request DB
 * cost in the layout. Uses the same niche subtype as the rich node so the @id
 * never carries conflicting @types.
 */
export function LocalBusinessRefJsonLd({ bundle, url }: Props) {
  const json = buildLocalBusinessRef(bundle, url);
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
