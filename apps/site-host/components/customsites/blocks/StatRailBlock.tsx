import type { CsStatRailBlock } from '@/lib/customsites-sanity';

interface Props {
  block: CsStatRailBlock;
}

/** Brass-keyline stat rail ("400+ Dental Clients Served"). Values are
 * author-entered text; footnote is the compliance qualifier slot. Renders
 * nothing without items — no invented numbers. */
export function StatRailBlock({ block }: Props) {
  const items = block.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className={block.inverse ? 'cs-section cs-section--navy' : 'cs-section'}>
      <div className="cs-container">
        {block.eyebrow ? (
          <span className={block.inverse ? 'cs-eyebrow cs-eyebrow--inverse' : 'cs-eyebrow'}>{block.eyebrow}</span>
        ) : null}
        <div className="cs-stat-rail">
          {items.map((item) => (
            <div key={item._key} className="cs-stat-item">
              <div className="cs-stat-value">{item.value}</div>
              <div className="cs-stat-label">{item.label}</div>
              {item.footnote ? <div className="cs-stat-footnote">{item.footnote}</div> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
