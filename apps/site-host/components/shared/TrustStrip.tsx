import type { Bundle, Variant } from '../../lib/content';

type Style = 'chips' | 'counters' | 'pills' | 'inline';

interface Props {
  bundle: Bundle;
  variant: Variant;
  style?: Style;
}

/** Default display style for each variant per the Phase-3 spec. */
const VARIANT_DEFAULT_STYLE: Record<Variant, Style> = {
  classic: 'chips',
  modern: 'counters',
  bright: 'pills',
  premium: 'inline',
};

/**
 * Variant-aware trust strip: license, insurance, years in business,
 * response-time promise, first guarantee.
 *
 * Renders nothing when no trust data is present — ADR 0003.
 */
export function TrustStrip({ bundle, variant, style }: Props) {
  const displayStyle = style ?? VARIANT_DEFAULT_STYLE[variant];

  // Gate: at least one trust datum must be present.
  const hasData =
    bundle.license_number ||
    bundle.insurance_carrier ||
    bundle.years_in_business != null ||
    bundle.response_time_promise ||
    bundle.guarantees[0];

  if (!hasData) return null;

  if (displayStyle === 'counters') {
    // Modern variant: numeric counter layout (years, review_count, response_time)
    const items: Array<{ value: string; label: string }> = [];

    if (bundle.years_in_business != null) {
      items.push({ value: String(bundle.years_in_business), label: 'years in business' });
    }
    if (bundle.aggregate_rating) {
      items.push({ value: String(bundle.aggregate_rating.review_count), label: 'verified reviews' });
    }
    if (bundle.response_time_promise) {
      items.push({ value: bundle.response_time_promise, label: 'response time' });
    }
    if (bundle.license_number) {
      items.push({ value: `#${bundle.license_number}`, label: 'license' });
    }
    if (bundle.insurance_carrier) {
      items.push({ value: 'Insured', label: bundle.insurance_carrier });
    }

    if (items.length === 0) return null;

    return (
      <div className="trust-strip trust-strip-counters" aria-label="Trust signals">
        {items.map((item) => (
          <div key={item.label} className="trust-strip-counter-item">
            <span className="trust-strip-counter-value num">{item.value}</span>
            <span className="trust-strip-counter-label">{item.label}</span>
          </div>
        ))}
      </div>
    );
  }

  // chips / pills / inline: flat list of signal strings
  const signals: string[] = [];
  if (bundle.license_number) signals.push(`Licensed #${bundle.license_number}`);
  if (bundle.insurance_carrier) signals.push(`Insured · ${bundle.insurance_carrier}`);
  else if (bundle.license_number) signals.push('Insured');
  if (bundle.years_in_business != null) signals.push(`${bundle.years_in_business} yrs in business`);
  if (bundle.response_time_promise) signals.push(bundle.response_time_promise);
  if (bundle.guarantees[0]) signals.push(bundle.guarantees[0]);

  if (signals.length === 0) return null;

  return (
    <div
      className={`trust-strip trust-strip-${displayStyle}`}
      aria-label="Trust signals"
    >
      {signals.map((s) => (
        <span key={s} className={`trust-strip-${displayStyle}-item`}>
          {displayStyle === 'chips' && <span className="trust-strip-chip-check" aria-hidden>✓</span>}
          {s}
        </span>
      ))}
    </div>
  );
}
