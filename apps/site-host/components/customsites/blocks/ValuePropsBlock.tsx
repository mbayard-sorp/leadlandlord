import Image from 'next/image';
import { csImageUrl, type CsValuePropsBlock } from '@/lib/customsites-sanity';
import { ValuePropIcon } from '../icons';

interface Props {
  block: CsValuePropsBlock;
}

/**
 * 2-3 up icon + heading + body triple. Icons are the built-in inline SVG
 * set, picked by name in the Studio — no uploads. Missing icon → heading
 * sits flush, no gap.
 *
 * An optional background photo flips the section to light-on-dark. It reuses
 * .cs-section--navy, which already inverts headings, body copy and links, so
 * the scrim variant does not need a parallel set of color rules.
 */
export function ValuePropsBlock({ block }: Props) {
  const items = block.items ?? [];
  if (items.length === 0) return null;

  const bg = block.backgroundImageUrl;

  return (
    <section className={`cs-section${bg ? ' cs-section--navy cs-valueprops-section--image' : ''}`}>
      {bg ? (
        <div className="cs-valueprops-bg">
          <Image
            src={csImageUrl(bg, { w: 2048 })}
            alt={block.backgroundImageAlt ?? ''}
            fill
            sizes="100vw"
            style={{ objectFit: 'cover' }}
          />
        </div>
      ) : null}
      <div className="cs-container" style={bg ? { position: 'relative', zIndex: 1 } : undefined}>
        {block.eyebrow ? (
          <span className={`cs-eyebrow${bg ? ' cs-eyebrow--inverse' : ''}`}>{block.eyebrow}</span>
        ) : null}
        {block.heading ? <h2>{block.heading}</h2> : null}
        <div className="cs-valueprops" style={{ marginTop: 'var(--cs-space-5)' }}>
          {items.map((item) => (
            <div key={item._key} className="cs-valueprop">
              <ValuePropIcon name={item.icon} className="cs-valueprop-icon" />
              <h3>{item.heading}</h3>
              <p>{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
