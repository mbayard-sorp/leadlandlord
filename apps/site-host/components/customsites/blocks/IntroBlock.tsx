import Image from 'next/image';
import { csImageUrl, type CsIntroBlock } from '@/lib/customsites-sanity';
import { Prose } from '../Prose';
import { hotspotPosition } from './hotspot';

interface Props {
  block: CsIntroBlock;
}

/**
 * Intro block, three layouts:
 *  - media: statement and body left, a photo right with an optional glass
 *    badge over its corner. Without a photo the copy takes the full width.
 *  - split (default): eyebrow/heading left, body + text-link right. Stacks on mobile.
 *  - stacked: heading above a full-width body; optional hairline rules between paragraphs.
 */
export function IntroBlock({ block }: Props) {
  const cta =
    block.ctaLabel && block.ctaHref ? (
      <a href={block.ctaHref} className="cs-link">
        {block.ctaLabel}
        <span className="cs-link-arrow" aria-hidden="true">
          →
        </span>
      </a>
    ) : null;

  if (block.layout === 'media') {
    const hasMedia = Boolean(block.mediaUrl);
    return (
      <section className="cs-section cs-intro-media-section">
        <div className="cs-container">
          <div className={`cs-intro-media${hasMedia ? '' : ' cs-intro-media--solo'}`}>
            <div className="cs-intro-media-copy">
              {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
              {block.heading ? <h2>{block.heading}</h2> : null}
              <Prose value={block.body} />
              {cta}
            </div>
            {hasMedia ? (
              <div className="cs-intro-media-frame">
                <Image
                  src={csImageUrl(block.mediaUrl, { w: 1100 })!}
                  alt={block.mediaAlt ?? ''}
                  fill
                  sizes="(max-width: 899px) 100vw, 520px"
                  style={{ objectFit: 'cover', objectPosition: hotspotPosition(block.mediaHotspot) }}
                />
                {block.mediaBadge ? (
                  <span className="cs-glass-badge">
                    <span className="cs-glass-badge-dot" aria-hidden="true" />
                    {block.mediaBadge}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  if (block.layout === 'stacked') {
    const proseClass = block.bodyDividers ? 'cs-prose--dividers' : undefined;
    const wrapClass = `cs-container cs-intro-stacked${block.topRule ? ' cs-intro-stacked--rule' : ''}`;
    return (
      <section className="cs-section">
        <div className={wrapClass}>
          {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
          {block.heading ? <h2>{block.heading}</h2> : null}
          <Prose value={block.body} className={proseClass} />
          {cta}
        </div>
      </section>
    );
  }

  return (
    <section className="cs-section">
      <div className="cs-container">
        <div className="cs-intro-grid">
          <div className="cs-intro-aside" data-cs-reveal>
            {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
            {block.heading ? <h2>{block.heading}</h2> : null}
          </div>
          <div data-cs-reveal>
            <Prose value={block.body} />
            {cta}
          </div>
        </div>
      </div>
    </section>
  );
}
