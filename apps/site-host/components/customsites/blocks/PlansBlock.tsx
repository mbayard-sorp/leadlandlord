import type { CsPlansBlock } from '@/lib/customsites-sanity';
import { resolveCurrentCustomSite } from '@/lib/custom-site-context';
import { csStoreAwareHref } from './StoreBadge';

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
 *
 * Until csSite.storeState is "live" there is nothing to start, so a plan's
 * button renders as a disabled "Coming soon" label instead of a link that
 * reads like checkout. All plan buttons flip with the header and mobile bar.
 */
export async function PlansBlock({ block }: Props) {
  const plans = block.plans ?? [];
  if (plans.length === 0) return null;
  // React.cache-deduped: the layout has already resolved the site.
  const site = await resolveCurrentCustomSite();
  const preLaunch = Boolean(site?.storeState) && site?.storeState !== 'live';

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
          {plans.map((plan) => {
            const ctaHref = csStoreAwareHref(site, plan.ctaHref);
            const hasCta = Boolean(plan.ctaLabel && ctaHref);
            const ctaClass = `cs-btn ${plan.recommended ? 'cs-btn-primary' : 'cs-btn-secondary'} cs-plan-cta`;
            return (
              <div
                key={plan._key}
                className={`cs-plan${plan.recommended ? ' cs-plan--recommended' : ''}${hasCta ? '' : ' cs-plan--static'}`}
              >
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
                {hasCta && preLaunch ? (
                  <span className={ctaClass} aria-disabled="true">
                    Coming soon
                  </span>
                ) : hasCta ? (
                  <a className={ctaClass} href={ctaHref} data-cs-store-cta={site?.storeState ? 'plan' : undefined}>
                    {plan.ctaLabel}
                  </a>
                ) : null}
                {plan.note ? <p className="cs-plan-note">{plan.note}</p> : null}
              </div>
            );
          })}
        </div>

        {block.footnote ? <p className="cs-footnote">{block.footnote}</p> : null}
      </div>
    </section>
  );
}
