import type { CsJourneyBlock } from '@/lib/customsites-sanity';

interface Props {
  block: CsJourneyBlock;
}

/**
 * The signature journey rail: a CSS-only horizontal scroll-snap track of
 * stage cards, each a real link to its /journey/<slug> stage page. Hover /
 * :focus-within raises the brass top rule; no JS, and the no-JS experience
 * is the same markup simply scrolling.
 */
export function JourneyBlock({ block }: Props) {
  const stages = block.stages ?? [];
  if (stages.length === 0) return null;

  return (
    <section className="cs-section cs-section--muted cs-journey">
      <div className="cs-container">
        {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
        {block.heading ? <h2>{block.heading}</h2> : null}
        {block.intro ? <p className="cs-lead">{block.intro}</p> : null}
        <div className="cs-journey-progress" aria-hidden="true">
          <span style={{ width: '100%' }} />
        </div>
        <div className="cs-journey-track">
          {stages.map((stage) => (
            <a key={stage._id} href={`/journey/${stage.slug}`} className="cs-journey-stage">
              <span className="cs-journey-num">{String(stage.order).padStart(2, '0')}</span>
              <h3>{stage.title}</h3>
              <p>{stage.summary}</p>
            </a>
          ))}
        </div>
        {block.ctaLabel && block.ctaHref ? (
          <p style={{ marginTop: 'var(--cs-space-5)' }}>
            <a href={block.ctaHref} className="cs-btn cs-btn-primary">
              {block.ctaLabel}
            </a>
          </p>
        ) : null}
      </div>
    </section>
  );
}
