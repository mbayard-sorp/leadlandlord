import type { CsValuePropsBlock } from '@/lib/customsites-sanity';
import { ValuePropIcon } from '../icons';

interface Props {
  block: CsValuePropsBlock;
}

/** 2-3 up icon + heading + body triple. Icons are the built-in inline SVG
 * set, picked by name in the Studio — no uploads. Missing icon → heading
 * sits flush, no gap. */
export function ValuePropsBlock({ block }: Props) {
  const items = block.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className="cs-section">
      <div className="cs-container">
        {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
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
