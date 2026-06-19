/**
 * MobileCallBar — sticky bottom CTA bar visible only on mobile.
 * Renders nothing when phone is absent.
 * CSS hides it at >= 768px via .bs-mobile-call-bar media query in buildsell.css.
 * A spacer div prevents the bar from overlapping page content.
 */

interface MobileCallBarProps {
  phone?: string | null;
}

export function MobileCallBar({ phone }: MobileCallBarProps) {
  if (!phone) return null;

  return (
    <>
      {/* Spacer reserves the bar height so content above isn't clipped */}
      <div className="bs-mobile-call-bar-spacer" aria-hidden="true" />

      <div className="bs-mobile-call-bar" role="complementary" aria-label="Call us">
        <a
          href={`tel:${phone}`}
          className="bs-btn bs-btn-primary bs-btn-lg bs-mobile-call-bar-btn"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.02 1.18 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z" />
          </svg>
          Call {phone}
        </a>
      </div>
    </>
  );
}
