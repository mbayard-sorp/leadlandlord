import { buildServiceNodes } from './buildsell-jsonld';
import type { BuildSellSite } from '@/lib/sanity';

interface BuildSellServiceJsonLdProps {
  site: BuildSellSite;
  /** Canonical public URL for this spec site render — used to absolutize service card links. */
  url: string;
}

/**
 * Service JSON-LD emitted for each card in a bsServicesSection, each one
 * cross-referencing the LocalBusiness @id as `provider`.
 *
 * Renders nothing when no services section or no titled cards are present —
 * safe to include unconditionally on the page.
 */
export function BuildSellServiceJsonLd({ site, url }: BuildSellServiceJsonLdProps) {
  const origin = new URL(url).origin;
  const nodes = buildServiceNodes(site.sections, origin);
  if (!nodes) return null;

  return (
    <>
      {nodes.map((node, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(node) }}
        />
      ))}
    </>
  );
}
