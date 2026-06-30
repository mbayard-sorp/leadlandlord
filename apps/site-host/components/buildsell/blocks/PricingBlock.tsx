import type { BuildSellSection } from '@/lib/sanity';

interface PricingBlockProps {
  section: BuildSellSection;
  layoutVariant: 'split' | 'bold' | 'trust';
}

function CheckMark() {
  return (
    <svg
      className="bs-price-check"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * Pricing section with two layouts off the same `tiers` data:
 *  - cards: tier cards with feature bullets; the `featured` tier is lifted.
 *  - table: compact name → price list; the `featured` row is tinted.
 * Prices are free strings (rendered with tabular figures for clean alignment),
 * so "$250", "From $99", and "Call for quote" all work without parsing.
 */
export function PricingBlock({ section }: PricingBlockProps) {
  const tiers = section.tiers ?? [];
  if (tiers.length === 0) return null;
  const isTable = section.layout === 'table';

  return (
    <section className="bs-section bs-reveal" id="pricing">
      <div className="bs-container">
        <div className="bs-section-head">
          {section.eyebrow && <p className="bs-section-eyebrow">{section.eyebrow}</p>}
          {section.heading && <h2 className="bs-section-title">{section.heading}</h2>}
          {section.subhead && <p className="bs-section-intro">{section.subhead}</p>}
        </div>

        {isTable ? (
          <div className="bs-pricetable" role="list">
            {tiers.map((tier, i) => (
              <div
                key={i}
                role="listitem"
                className={
                  'bs-pricetable-row' +
                  (tier.featured ? ' bs-pricetable-row--featured' : '')
                }
              >
                <div className="bs-pricetable-info">
                  <div className="bs-pricetable-name">
                    {tier.name}
                    {tier.featured && tier.badge && (
                      <span className="bs-pricetable-badge">{tier.badge}</span>
                    )}
                  </div>
                  {tier.description && (
                    <div className="bs-pricetable-desc">{tier.description}</div>
                  )}
                </div>
                <div className="bs-pricetable-price">
                  <span className="amt">{tier.price}</span>
                  {tier.unit && <span className="unit">{tier.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bs-pricing-grid">
            {tiers.map((tier, i) => {
              const ctaLabel = tier.cta?.label ?? 'Get a Quote';
              const ctaHref = tier.cta?.href ?? '#contact';
              return (
                <div
                  key={i}
                  className={
                    'bs-price-card' + (tier.featured ? ' bs-price-card--featured' : '')
                  }
                >
                  {tier.featured && tier.badge && (
                    <span className="bs-price-badge">{tier.badge}</span>
                  )}
                  <h3 className="bs-price-name">{tier.name}</h3>
                  <div className="bs-price-amount">
                    <span className="amt">{tier.price}</span>
                    {tier.unit && <span className="unit">{tier.unit}</span>}
                  </div>
                  {tier.description && (
                    <p className="bs-price-desc">{tier.description}</p>
                  )}
                  {tier.features && tier.features.length > 0 && (
                    <ul className="bs-price-features" role="list">
                      {tier.features.map((f, j) => (
                        <li key={j}>
                          <CheckMark />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <a
                    href={ctaHref}
                    className={
                      'bs-btn ' +
                      (tier.featured ? 'bs-btn-primary' : 'bs-btn-outline')
                    }
                  >
                    {ctaLabel}
                  </a>
                </div>
              );
            })}
          </div>
        )}

        {section.footnote && <p className="bs-pricing-footnote">{section.footnote}</p>}
      </div>
    </section>
  );
}
