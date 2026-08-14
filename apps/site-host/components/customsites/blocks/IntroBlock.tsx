import type { CsIntroBlock } from '@/lib/customsites-sanity';
import { Prose } from '../Prose';

interface Props {
  block: CsIntroBlock;
}

/**
 * Intro block, two layouts:
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
