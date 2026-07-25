import type { CsCalloutBlock } from '@/lib/customsites-sanity';

interface Props {
  block: CsCalloutBlock;
}

/** Brass-left-border panel: label, quote, link. */
export function CalloutBlock({ block }: Props) {
  return (
    <section className="cs-section">
      <div className="cs-container">
        <div className="cs-callout">
          {block.label ? <p className="cs-callout-label">{block.label}</p> : null}
          {block.quote ? <p className="cs-callout-quote">{block.quote}</p> : null}
          {block.linkLabel && block.linkHref ? (
            <p style={{ marginTop: 16 }}>
              <a href={block.linkHref} className="cs-link">
                {block.linkLabel}
                <span className="cs-link-arrow" aria-hidden="true">
                  →
                </span>
              </a>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
