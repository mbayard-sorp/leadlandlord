/**
 * DraftShield — fixed overlay + top banner shown only on /preview/[id] routes.
 * Pointer-events are off on the watermark layer so the page remains usable.
 * The banner (pointer-events on) links to a mailto for purchase inquiry.
 */
export function DraftShield() {
  return (
    <>
      {/* Diagonal watermark — no pointer interaction */}
      <div className="bs-draft-watermark" aria-hidden="true">
        <span className="bs-draft-watermark-text">Draft Preview</span>
      </div>

      {/* Top banner — fully interactive */}
      <div className="bs-draft-banner" role="banner">
        <span>Draft — available for purchase.</span>
        <a href="mailto:hello@leadslandlord.com?subject=Purchase%20Inquiry">
          Contact us to purchase this site
        </a>
      </div>
    </>
  );
}
