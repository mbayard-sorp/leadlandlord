import type { CsStoreState } from '@/lib/customsites-sanity';

interface Props {
  state?: CsStoreState | null;
  /** Pill text while the app is not on the store yet. */
  label?: string | null;
  href?: string | null;
  /** Where this badge sits. Read by the site's own GTM click trigger. */
  placement: 'hero' | 'band' | 'footer' | 'sticky';
}

/**
 * The App Store call to action, in its two states.
 *
 * `soon` is an ink pill that is deliberately NOT a link and NOT a disabled
 * button — there is nowhere to go yet, and a dead control that looks clickable
 * is worse than a plain statement.
 *
 * `live` is Apple's own badge asset, served from /cueduo/app-store-badge.svg.
 * Apple's marketing guidelines forbid recolouring, redrawing, animating or
 * shrinking it below 40px tall, so it is an <img> of the unmodified file at a
 * fixed 180x60 and nothing in the stylesheet restyles it. The file is
 * downloaded from Apple's marketing resources by hand — see the README beside
 * it. next/image is deliberately not used: the asset is a local SVG, so the
 * optimizer would add a request and no benefit.
 *
 * Click tracking is left to the site's own GTM container (ADR 0033 D5 — no
 * central GA4 on this line). The `data-cs-store-cta` attribute is the trigger
 * hook, so this stays a server component with no client JS.
 */
export function StoreBadge({ state, label, href, placement }: Props) {
  if (state === 'live' && href) {
    return (
      <a className="cs-storebadge" href={href} data-cs-store-cta={placement}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/cueduo/app-store-badge.svg" alt="Download on the App Store" width={180} height={60} />
      </a>
    );
  }

  if (!label) return null;
  return (
    <span className="cs-storebadge--soon" data-cs-store-cta={placement}>
      {label}
    </span>
  );
}
