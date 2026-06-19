'use client';

/**
 * BuildSellMotion — single client island for all scroll-based interactivity.
 * Renders nothing to the DOM (returns null). All effects are applied to
 * existing server-rendered elements via class mutations.
 *
 * Three behaviors:
 * 1. Scroll-reveal: IntersectionObserver toggles `.is-revealed` on
 *    `.bs-reveal` elements. When prefers-reduced-motion is set, all
 *    `.bs-reveal` elements are marked revealed immediately on mount.
 * 2. Sticky-nav: scroll listener toggles `.is-scrolled` on `[data-nav]`
 *    once the user passes 20px of vertical scroll.
 * 3. Stat counters: animates any `.bs-stat-value` element whose text begins
 *    with a numeric prefix (e.g. "500+" or "12"). When prefers-reduced-motion
 *    is set, the final value is painted immediately with no animation.
 */

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

function parseNumericPrefix(text: string): { prefix: string; num: number; suffix: string } | null {
  const match = text.match(/^(\d[\d,.]*)(.*)$/);
  if (!match || !match[1]) return null;
  const rawNum = match[1].replace(/,/g, '');
  const num = parseFloat(rawNum);
  if (isNaN(num)) return null;
  return { prefix: '', num, suffix: match[2] ?? '' };
}

function animateCounter(el: HTMLElement, num: number, suffix: string, duration: number) {
  const start = performance.now();
  const startVal = 0;

  function tick(now: number) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(startVal + (num - startVal) * eased);
    el.textContent = current.toLocaleString() + suffix;
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      el.textContent = num.toLocaleString() + suffix;
    }
  }

  requestAnimationFrame(tick);
}

export function BuildSellMotion() {
  // The draft preview theme bar switches layout via a soft navigation, which
  // re-renders the server block structure into fresh DOM nodes. Re-key the
  // effect on the route + query string so the observers re-attach to the new
  // `.bs-reveal` / `.bs-stat-value` elements (otherwise they stay at opacity 0).
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cleanups: Array<() => void> = [];

    // --- 1. Scroll-reveal (the only motion gated on reduced-motion) -------
    const revealEls = Array.from(document.querySelectorAll<HTMLElement>('.bs-reveal'));
    if (prefersReduced) {
      // Paint immediately — content must be visible without motion
      revealEls.forEach((el) => el.classList.add('is-revealed'));
    } else {
      const revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-revealed');
              revealObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: '0px 0px -48px 0px' },
      );
      revealEls.forEach((el) => revealObserver.observe(el));
      cleanups.push(() => revealObserver.disconnect());
    }

    // --- 2. Sticky-nav scrolled state (always on) ------------------------
    const nav = document.querySelector<HTMLElement>('[data-nav]');
    function handleScroll() {
      if (!nav) return;
      nav.classList.toggle('is-scrolled', window.scrollY > 20);
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // set correct initial state
    cleanups.push(() => window.removeEventListener('scroll', handleScroll));

    // --- 3. Stat counters (always on; reduced-motion paints final value) -
    const statEls = Array.from(document.querySelectorAll<HTMLElement>('.bs-stat-value'));
    if (!prefersReduced) {
      const counterObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const el = entry.target as HTMLElement;
            const original = el.dataset.bsStatFinal ?? el.textContent ?? '';
            const parsed = parseNumericPrefix(original);
            if (!parsed) return;
            counterObserver.unobserve(el);
            animateCounter(el, parsed.num, parsed.suffix, 1200);
          });
        },
        { threshold: 0.5 },
      );
      statEls.forEach((el) => {
        // Stash the final value before we animate so a re-observe never double-runs
        if (!el.dataset.bsStatFinal) {
          el.dataset.bsStatFinal = el.textContent ?? '';
        }
        counterObserver.observe(el);
      });
      cleanups.push(() => counterObserver.disconnect());
    }
    // reduced-motion: server-rendered final stat value is already visible (no-op)

    return () => cleanups.forEach((fn) => fn());
  }, [pathname, search]);

  return null;
}
