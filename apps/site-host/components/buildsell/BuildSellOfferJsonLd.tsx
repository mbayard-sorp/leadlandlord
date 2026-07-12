import { buildAggregateOfferNode } from './buildsell-jsonld';
import type { BuildSellSite } from '@/lib/sanity';

interface BuildSellOfferJsonLdProps {
  site: BuildSellSite;
  /** Canonical public URL for this spec site render. */
  url: string;
}

/**
 * AggregateOffer JSON-LD built from the bsPricingSection tiers.
 *
 * Tier prices are operator free text ("$150/hr", "Custom") — numeric price
 * fields are only emitted when a price is actually parseable, and
 * lowPrice/highPrice are derived only from the tiers that parse. Renders
 * nothing when there's no pricing section.
 */
export function BuildSellOfferJsonLd({ site, url }: BuildSellOfferJsonLdProps) {
  const origin = new URL(url).origin;
  const node = buildAggregateOfferNode(site.sections, origin);
  if (!node) return null;

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(node) }}
    />
  );
}
