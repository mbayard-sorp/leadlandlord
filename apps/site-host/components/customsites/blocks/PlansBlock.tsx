import type { CsPlansBlock } from '@/lib/customsites-sanity';

interface Props {
  block: CsPlansBlock;
}

/**
 * Plan cards mirroring the in-app paywall. `price` is a string, not a number,
 * so what the page shows is exactly what the App Store shows, currency symbol
 * and all.
 *
 * The site never takes payment — every CTA is a link out, and a plan with
 * nothing to buy (the free tier) carries a `note` where the button would be
 * rather than a dead control.
 */
export function PlansBlock({ block }: Props) {
  const plans = block.plans ?? [];
  if (plans.length === 0) return null;

  return (
    <section className="cs-section cs-plans" id="pricing">
      <div className="cs-container">
        <div className="cs-section-head">
          <div>
            {block.eyebrow ? <p className="cs-eyebrow cs-eyebrow--quiet">{block.eyebrow}</p> : null}
            {block.heading ? <h2>{block.heading}</h2> : null}
          </div>
          {block.intro ? <p className="cs-section-head-aside">{block.intro}</p> : null}
        </div>

        <div className="cs-plan-grid">
          {plans.map((plan) => (
            <div key={plan._key} className={`cs-plan${plan.recommended ? ' cs-plan--recommended' : ''}`}>
              <p className="cs-plan-name">
                {plan.name}
                {plan.recommended ? <span className="cs-plan-flag">Recommended</span> : null}
              </p>
              <p className="cs-plan-price">
                {plan.price}
                {plan.period ? <span className="cs-plan-period"> {plan.period}</span> : null}
              </p>
              {plan.features && plan.features.length > 0 ? (
                <ul className="cs-plan-list">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              ) : null}
              {plan.ctaLabel && plan.ctaHref ? (
                <a
                  className={`cs-btn ${plan.recommended ? 'cs-btn-primary' : 'cs-btn-secondary'} cs-plan-cta`}
                  href={plan.ctaHref}
                >
                  {plan.ctaLabel}
                </a>
              ) : null}
              {plan.note ? <p className="cs-plan-note">{plan.note}</p> : null}
            </div>
          ))}
        </div>

        {block.footnote ? <p className="cs-footnote">{block.footnote}</p> : null}
      </div>
    </section>
  );
}
