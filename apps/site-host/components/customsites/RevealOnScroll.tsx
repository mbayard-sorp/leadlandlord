'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Scroll reveal for Custom Sites (ADR 0033). Watches every `[data-cs-reveal]`
 * element and fades it up as it enters the viewport.
 *
 * Two deliberate properties:
 *
 *  - **No-JS safe.** The hidden state lives in a class this script adds, not
 *    in the server-rendered HTML. If the script never runs — JS off, hydration
 *    error, old browser — every element stays visible. Reveal styling is
 *    strictly additive to a page that already reads correctly without it.
 *
 *  - **No flash.** Anything already inside the viewport at mount is skipped
 *    entirely: never hidden, never animated. Hiding it post-hydration would
 *    make above-the-fold content visibly pop out and fade back in. Only
 *    off-screen elements — where the transition is invisible until the user
 *    scrolls to them — get the treatment.
 *
 * Bails completely under prefers-reduced-motion. The global reduce block in
 * adr.css collapses transition durations, but that would still leave elements
 * momentarily at opacity 0; not applying the class at all is the honest
 * version of "no motion".
 */
export function RevealOnScroll() {
  /* Re-scan on route change. Today every in-site link is a plain <a>, so
     navigation is a full document load and a mount-only effect would be
     enough. That is incidental, not by design — the moment any of these
     become next/link, client navigation would swap in new [data-cs-reveal]
     content that no observer is watching, and reveals would silently stop.
     Failure mode would be benign (content stays visible) but silent, which is
     the worse kind. */
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!('IntersectionObserver' in window)) return;

    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-cs-reveal]'));
    if (els.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.remove('cs-reveal-hidden');
          // One-shot: nothing re-hides on scroll back up.
          io.unobserve(entry.target);
        }
      },
      // threshold 0 + a bottom inset fires when the element's top edge has
      // risen ~12% of the viewport above the fold. A percentage threshold
      // would behave inconsistently across elements taller than the viewport.
      { threshold: 0, rootMargin: '0px 0px -12% 0px' },
    );

    for (const el of els) {
      const rect = el.getBoundingClientRect();
      const onScreen = rect.top < window.innerHeight && rect.bottom > 0;
      if (onScreen) continue;
      el.classList.add('cs-reveal-hidden');
      io.observe(el);
    }

    return () => io.disconnect();
  }, [pathname]);

  return null;
}
