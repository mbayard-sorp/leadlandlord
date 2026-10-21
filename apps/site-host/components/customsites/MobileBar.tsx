import type { CustomSiteMobileBar } from '@/lib/customsites-sanity';

interface Props {
  bar?: CustomSiteMobileBar | null;
}

/**
 * Sticky mobile bar for sites with no phone number: a short line plus one
 * button (e.g. the app download). The non-phone sibling of StickyBar, shown
 * below ~899px only (see .cs-mobilebar in cueduo.css). It is `position:
 * sticky` and the last child of the page root, so it pins to the viewport
 * bottom while scrolling and rests below the footer at the end, which is why
 * it needs no spacer. No-op unless the button has both a label and a
 * destination.
 *
 * Click tracking is left to the site's own GTM container (ADR 0033 D5);
 * `data-cs-store-cta="sticky"` is the trigger hook, same as StoreBadge.
 */
export function MobileBar({ bar }: Props) {
  if (!bar?.ctaLabel || !bar.ctaHref) return null;
  return (
    <div className="cs-mobilebar">
      {bar.text ? <span className="cs-mobilebar-text">{bar.text}</span> : null}
      <a href={bar.ctaHref} className="cs-mobilebar-cta" data-cs-store-cta="sticky">
        {bar.ctaLabel}
      </a>
    </div>
  );
}
