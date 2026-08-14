import type { CsNumbersIqBlock } from '@/lib/customsites-sanity';
import { Prose } from '../Prose';

interface Props {
  block: CsNumbersIqBlock;
}

/** Product callout on the inverse band with static benchmark meters (no JS —
 * fill widths are inline styles from author-entered percentages). Meters are
 * an illustration of the product, labeled "Illustrative" unless switched off. */
export function NumbersIqBlock({ block }: Props) {
  const metrics = block.metrics ?? [];

  return (
    <section className="cs-section cs-section--navy">
      <div className="cs-container cs-numbersiq">
        <div>
          {block.eyebrow ? <span className="cs-eyebrow cs-eyebrow--inverse">{block.eyebrow}</span> : null}
          {block.heading ? <h2>{block.heading}</h2> : null}
          <Prose value={block.body} />
          {block.ctaLabel && block.ctaHref ? (
            <p style={{ marginTop: 'var(--cs-space-4)' }}>
              <a
                href={block.ctaHref}
                className="cs-btn cs-btn-primary"
                {...(block.ctaHref.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                {block.ctaLabel}
              </a>
            </p>
          ) : null}
        </div>
        {metrics.length > 0 ? (
          <div className="cs-meter">
            {block.illustrative !== false ? (
              <span className="cs-meter-label" style={{ letterSpacing: '0.1em' }}>
                Illustrative
              </span>
            ) : null}
            {metrics.map((m) => (
              <div key={m._key} className="cs-meter-row">
                <span className="cs-meter-label">{m.label}</span>
                <div
                  className="cs-meter-track"
                  role="img"
                  aria-label={`${m.label}: ${m.valueLabel ?? `${m.percent}%`}`}
                >
                  <div className="cs-meter-fill" style={{ width: `${Math.min(100, Math.max(0, m.percent))}%` }} />
                </div>
                <span className="cs-meter-value">{m.valueLabel ?? `${m.percent}%`}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
