import { telHref } from '../../lib/content';

interface Props {
  phone: string;
  cta?: string;
  ctaHref?: string;
  bg?: string;
  fg?: string;
  ctaBg?: string;
  ctaFg?: string;
}

/**
 * Fixed bottom bar on mobile with click-to-call + secondary CTA.
 * Phone CTA is the primary lead-gen action — the bar follows the user as they scroll.
 */
export function StickyMobileBar({
  phone,
  cta = 'Get quote',
  ctaHref = '/contact',
  bg = '#0f1620',
  fg = '#fbf8f1',
  ctaBg = '#ff7a1f',
  ctaFg = '#0f1620',
}: Props) {
  return (
    <div
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 border-t-2"
      style={{ background: bg, color: fg, borderColor: bg }}
    >
      <a
        href={telHref(phone)}
        className="flex items-center gap-2 font-bold text-sm tabular-nums"
        aria-label={`Call ${phone}`}
      >
        <span aria-hidden>☎</span>
        <span>{phone}</span>
      </a>
      <a
        href={ctaHref}
        className="px-3 py-1.5 rounded-full font-bold text-xs uppercase tracking-wide"
        style={{ background: ctaBg, color: ctaFg }}
      >
        {cta}
      </a>
    </div>
  );
}
