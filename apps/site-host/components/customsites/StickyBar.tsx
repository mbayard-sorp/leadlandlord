interface Props {
  phone?: string | null;
}

/**
 * Sticky mobile call bar + spacer (fourth of the four required phone-CTA
 * placements: header / hero / mid-page / sticky-mobile). No-op when the site
 * has no phone number on file.
 */
export function StickyBar({ phone }: Props) {
  if (!phone) return null;
  return (
    <>
      <div className="cs-sticky-bar">
        <a href={`tel:${phone}`} className="cs-btn cs-btn-primary" aria-label={`Call ${phone}`}>
          Call {phone}
        </a>
      </div>
      <div className="cs-sticky-spacer" aria-hidden="true" />
    </>
  );
}
