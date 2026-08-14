import type { CsCompareBlock } from '@/lib/customsites-sanity';

interface Props {
  block: CsCompareBlock;
  /** The "us" column label when a row needs one — the site's business name. */
  siteName?: string | null;
}

/** "Traditional X vs us" paired quote rows. The right cell carries the brass
 * keyline; rightLabel falls back to the site name so the block is never
 * branded for the wrong site. */
export function CompareBlock({ block, siteName }: Props) {
  const rows = block.rows ?? [];
  if (rows.length === 0) return null;

  const rightLabel = block.rightLabel?.trim() || siteName || 'Us';

  return (
    <section className="cs-section">
      <div className="cs-container">
        {block.eyebrow ? <span className="cs-eyebrow cs-eyebrow--center">{block.eyebrow}</span> : null}
        {block.heading ? <h2 style={{ textAlign: 'center' }}>{block.heading}</h2> : null}
        {block.intro ? (
          <p className="cs-lead" style={{ textAlign: 'center', marginInline: 'auto' }}>
            {block.intro}
          </p>
        ) : null}
        <div className="cs-compare" style={{ marginTop: 'var(--cs-space-5)' }}>
          {rows.map((row) => (
            <div key={row._key} className="cs-compare-row">
              <div className="cs-compare-cell">
                <p className="cs-compare-who">{row.leftWho}</p>
                <p>&ldquo;{row.leftQuote}&rdquo;</p>
              </div>
              <div className="cs-compare-cell cs-compare-cell--ours">
                <p className="cs-compare-who">{rightLabel}</p>
                <p>&ldquo;{row.rightQuote}&rdquo;</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
