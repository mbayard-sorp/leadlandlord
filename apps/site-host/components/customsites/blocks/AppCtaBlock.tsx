import Image from 'next/image';
import type { CsAppCtaBlock } from '@/lib/customsites-sanity';
import { StoreBadge } from './StoreBadge';

interface Props {
  block: CsAppCtaBlock;
  /** csSite.logo — the mark set above the heading when Show Mark is on. */
  logoUrl?: string | null;
  siteName?: string | null;
}

/**
 * The closing band: mark, one line, the store call to action, the qualifier.
 * Graphite by default, which is where the accent flips to Cobalt Bright with
 * graphite ink on top (the contrast decision in cueduo.css).
 */
export function AppCtaBlock({ block, logoUrl, siteName }: Props) {
  const graphite = block.band !== 'porcelain';

  return (
    <section className={`cs-section cs-appcta${graphite ? ' cs-section--navy' : ''}`} id="get">
      <div className="cs-container">
        {block.showMark !== false && logoUrl ? (
          <Image
            className="cs-appcta-mark"
            src={logoUrl}
            alt={siteName ?? ''}
            width={34}
            height={34}
          />
        ) : null}
        <h2 className="cs-appcta-heading">{block.heading}</h2>
        {block.body ? <p className="cs-appcta-body">{block.body}</p> : null}
        <div className="cs-appcta-actions">
          <StoreBadge state={block.storeState} label={block.storeLabel} href={block.storeHref} placement="band" />
        </div>
        {block.qualifier ? <p className="cs-appcta-note">{block.qualifier}</p> : null}
      </div>
    </section>
  );
}
