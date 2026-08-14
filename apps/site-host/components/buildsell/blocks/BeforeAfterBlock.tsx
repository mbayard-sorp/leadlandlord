import Image from 'next/image';
import type { BuildSellSection } from '@/lib/sanity';
import { BeforeAfterSlider } from './BeforeAfterSlider';

interface BeforeAfterBlockProps {
  section: BuildSellSection;
  layoutVariant: 'split' | 'bold' | 'trust';
}

/** Frame shapes offered in Studio. Anything else falls back to 4:3. */
const ASPECTS = new Set(['4/3', '16/9', '1/1', '3/4']);

/**
 * Before / After gallery — the proof section for trade sites.
 *
 * Two layouts off the same `pairs` data:
 *  - slider: both photos in one frame with a draggable divider (BeforeAfterSlider,
 *    a client leaf). The reveal is the interaction, so it wants matched framing.
 *  - grid: the pair side by side under labels. Server-rendered, zero JS, and the
 *    right call when the two shots are not framed alike.
 *
 * Every frame is locked to one aspect ratio so the row stays aligned and images
 * reserve their space before they load. Pairs missing either half are dropped —
 * a one-sided comparison is worse than no comparison.
 */
export function BeforeAfterBlock({ section, layoutVariant: _layoutVariant }: BeforeAfterBlockProps) {
  const pairs = (section.pairs ?? []).filter((p) => p.beforeUrl && p.afterUrl);
  if (pairs.length === 0) return null;

  const isGrid = section.layout === 'grid';
  const aspect = section.aspect && ASPECTS.has(section.aspect) ? section.aspect : '4/3';
  const beforeLabel = section.beforeLabel || 'Before';
  const afterLabel = section.afterLabel || 'After';
  const ctaLabel = section.cta?.label;
  const ctaHref = section.cta?.href ?? '#contact';

  return (
    <section className="bs-section bs-reveal" id="before-after">
      <div className="bs-container">
        <div className="bs-section-head">
          {section.eyebrow && <p className="bs-section-eyebrow">{section.eyebrow}</p>}
          {section.heading && <h2 className="bs-section-title">{section.heading}</h2>}
          {section.subhead && <p className="bs-section-intro">{section.subhead}</p>}
        </div>

        <div
          className={
            'bs-ba-gallery' +
            // Grid pairs hold two photos per cell, so they need a wider track
            // before the row is allowed to split into columns.
            (isGrid ? ' bs-ba-gallery--pairs' : '') +
            (pairs.length === 1 ? ' bs-ba-gallery--single' : '')
          }
          role="list"
        >
          {pairs.map((pair, i) => {
            const beforeAlt =
              pair.beforeAlt ||
              (pair.title ? `${pair.title} — ${beforeLabel.toLowerCase()}` : `${beforeLabel} photo`);
            const afterAlt =
              pair.afterAlt ||
              (pair.title ? `${pair.title} — ${afterLabel.toLowerCase()}` : `${afterLabel} photo`);

            return (
              <figure className="bs-ba-item" role="listitem" key={i}>
                {isGrid ? (
                  <div className="bs-ba-pair">
                    <div className="bs-ba-half" style={{ aspectRatio: aspect }}>
                      <Image
                        className="bs-ba-img"
                        src={pair.beforeUrl!}
                        alt={beforeAlt}
                        fill
                        sizes="(max-width: 599px) 50vw, (max-width: 1023px) 45vw, 280px"
                        style={{ objectFit: 'cover' }}
                      />
                      <span className="bs-ba-chip bs-ba-chip--before">{beforeLabel}</span>
                    </div>
                    <div className="bs-ba-half" style={{ aspectRatio: aspect }}>
                      <Image
                        className="bs-ba-img"
                        src={pair.afterUrl!}
                        alt={afterAlt}
                        fill
                        sizes="(max-width: 599px) 50vw, (max-width: 1023px) 45vw, 280px"
                        style={{ objectFit: 'cover' }}
                      />
                      <span className="bs-ba-chip bs-ba-chip--after">{afterLabel}</span>
                    </div>
                  </div>
                ) : (
                  <BeforeAfterSlider
                    beforeUrl={pair.beforeUrl!}
                    afterUrl={pair.afterUrl!}
                    beforeAlt={beforeAlt}
                    afterAlt={afterAlt}
                    beforeLabel={beforeLabel}
                    afterLabel={afterLabel}
                    aspect={aspect}
                    title={pair.title}
                    priority={i === 0}
                  />
                )}

                {(pair.title || pair.caption) && (
                  <figcaption className="bs-ba-caption">
                    {pair.title && <span className="bs-ba-title">{pair.title}</span>}
                    {pair.caption && <span className="bs-ba-note">{pair.caption}</span>}
                  </figcaption>
                )}
              </figure>
            );
          })}
        </div>

        {ctaLabel && (
          <div className="bs-ba-cta">
            <a href={ctaHref} className="bs-btn bs-btn-primary bs-btn-lg">
              {ctaLabel}
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
