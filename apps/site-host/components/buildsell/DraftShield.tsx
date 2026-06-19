/**
 * DraftShield — fixed overlay + top banner shown only on /preview/[id] routes.
 * Pointer-events are off on the watermark layer so the page remains usable.
 *
 * When purchaseUrl is a valid http/https URL, the banner CTA points there
 * (external link, target=_blank rel=noopener). When absent or non-http(s),
 * fallback to the operator mailto. A non-http(s) value NEVER renders as the
 * CTA href (R22 guard).
 */

interface DraftShieldProps {
  purchaseUrl?: string | null;
}

function isValidPurchaseUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const FALLBACK_MAILTO =
  'mailto:hello@leadslandlord.com?subject=Purchase%20Inquiry';

export function DraftShield({ purchaseUrl }: DraftShieldProps) {
  const ctaHref = isValidPurchaseUrl(purchaseUrl) ? purchaseUrl : FALLBACK_MAILTO;
  const isExternal = ctaHref.startsWith('http');

  return (
    <>
      {/* Diagonal watermark — no pointer interaction */}
      <div className="bs-draft-watermark" aria-hidden="true">
        <span className="bs-draft-watermark-text">Draft Preview</span>
      </div>

      {/* Top banner — fully interactive */}
      <div className="bs-draft-banner" role="banner">
        <span>Draft — available for purchase.</span>
        <a
          href={ctaHref}
          {...(isExternal
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {})}
        >
          Purchase this site
        </a>
      </div>
    </>
  );
}
