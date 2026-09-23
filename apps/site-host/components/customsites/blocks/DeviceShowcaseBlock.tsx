import Image from 'next/image';
import { csImageUrl, type CsDeviceShowcaseBlock } from '@/lib/customsites-sanity';

interface Props {
  block: CsDeviceShowcaseBlock;
}

/**
 * Copy beside one app screen, alternating sides down the page. The device
 * frame is drawn in CSS so the uploaded screen stays a clean 1:1 export with
 * no shadow or bezel baked in.
 *
 * With no screen uploaded the media column is dropped entirely and the copy
 * takes the full width. That is deliberate: a placeholder tile would imply the
 * screenshot exists, and there is no honest stand-in for a real app frame.
 */
export function DeviceShowcaseBlock({ block }: Props) {
  const graphite = block.band === 'graphite';
  const sideClass = block.side === 'left' ? ' cs-showcase--left' : '';
  const hasScreen = Boolean(block.screenUrl);

  return (
    <section className={`cs-section cs-showcase${sideClass}${graphite ? ' cs-section--navy' : ''}`}>
      <div className="cs-container">
        <div className={`cs-showcase-grid${hasScreen ? '' : ' cs-showcase-grid--solo'}`}>
          <div className="cs-showcase-copy">
            {block.eyebrow ? (
              <p className={`cs-eyebrow${graphite ? ' cs-eyebrow--inverse' : ' cs-eyebrow--quiet'}`}>{block.eyebrow}</p>
            ) : null}
            <h2>{block.heading}</h2>
            {block.body ? <p>{block.body}</p> : null}
            {block.ctaLabel && block.ctaHref ? (
              <a className="cs-underline-link cs-underline-link--accent" href={block.ctaHref}>
                {block.ctaLabel}
              </a>
            ) : null}
          </div>
          {hasScreen && block.screenUrl ? (
            <figure className="cs-showcase-media">
              <div className="cs-device">
                <Image
                  className="cs-device-screen"
                  src={csImageUrl(block.screenUrl, { w: 960 })}
                  alt={block.screenAlt ?? ''}
                  width={480}
                  height={678}
                  sizes="(max-width: 899px) 100vw, 480px"
                />
              </div>
              {block.caption ? <figcaption className="cs-device-caption">{block.caption}</figcaption> : null}
            </figure>
          ) : null}
        </div>
      </div>
    </section>
  );
}
