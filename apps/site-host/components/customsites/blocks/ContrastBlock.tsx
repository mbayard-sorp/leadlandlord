import type { CsContrastBlock } from '@/lib/customsites-sanity';

interface Props {
  block: CsContrastBlock;
}

/**
 * Two labelled columns of paired lines: the usual way, and the way this
 * product does it.
 *
 * Separate from csCompareBlock on purpose. That block renders attributed
 * quotes, which would mean inventing a person to say them; this one states a
 * workflow and nothing more. The `footnote` exists so a page can say out loud
 * what the comparison is NOT claiming, since any measurable claim needs a
 * source.
 *
 * Markup is row-per-pair so the two sides stay associated when the grid
 * collapses to one column on a phone.
 */
export function ContrastBlock({ block }: Props) {
  const rows = block.rows ?? [];
  if (rows.length === 0) return null;

  return (
    <section className="cs-section cs-contrast">
      <div className="cs-container">
        <div className="cs-contrast-head">
          <div>
            {block.eyebrow ? <p className="cs-eyebrow cs-eyebrow--quiet">{block.eyebrow}</p> : null}
            <h2>{block.heading}</h2>
          </div>
          <p className="cs-contrast-label cs-contrast-label--left">{block.leftLabel}</p>
          <p className="cs-contrast-label cs-contrast-label--right">{block.rightLabel}</p>
        </div>
        <ul className="cs-contrast-rows">
          {rows.map((row) => (
            <li key={row._key} className="cs-contrast-row">
              <span className="cs-contrast-cell cs-contrast-cell--left">
                <span className="cs-contrast-inline-label">{block.leftLabel}</span>
                {row.left}
              </span>
              <span className="cs-contrast-cell cs-contrast-cell--right">
                <span className="cs-contrast-inline-label">{block.rightLabel}</span>
                {row.right}
              </span>
            </li>
          ))}
        </ul>
        {block.footnote ? <p className="cs-footnote">{block.footnote}</p> : null}
      </div>
    </section>
  );
}
