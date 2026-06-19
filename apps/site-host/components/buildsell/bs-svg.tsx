/**
 * Server-rendered inline SVGs for BuildSell — premium star ratings + CTA glyphs.
 * Kept as plain inline SVG (no 'use client', no lucide bundle) so they cost zero
 * client JS and the stars fill cleanly with --bs-accent.
 */

interface StarsProps {
  /** Numeric rating, used for the accessible label (visual is always 5 filled). */
  rating?: number;
  count?: number;
  size?: number;
  className?: string;
}

/** Row of solid accent-filled stars (matches the polished design reference). */
export function Stars({ rating, count = 5, size = 16, className }: StarsProps) {
  const label = rating != null ? `${rating} out of 5 stars` : `${count} star rating`;
  return (
    <span className={`bs-stars ${className ?? ''}`} role="img" aria-label={label}>
      {Array.from({ length: count }).map((_, i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      ))}
    </span>
  );
}

/** Trailing CTA arrow. */
export function ArrowRightIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="bs-cta-arrow">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/** Send / paper-plane glyph for form submit. */
export function SendIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="bs-cta-arrow">
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}
