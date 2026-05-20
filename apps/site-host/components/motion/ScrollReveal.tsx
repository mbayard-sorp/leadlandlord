'use client';

/**
 * ScrollReveal - client leaf wrapper for below-the-fold scroll animations.
 *
 * CSS class contract (Phase 2 must add these to a shared stylesheet):
 *   .scroll-reveal          - initial state: opacity 0, transform translateY(24px)
 *   .scroll-reveal.is-revealed - revealed state: opacity 1, transform translateY(0)
 *   Transition: opacity + transform only (compositor-safe).
 *   @media (prefers-reduced-motion: reduce): skip transition, reveal instantly.
 *
 * Design invariants (ADR 0012):
 *   - Children are always present in server HTML (no conditional mounting).
 *   - Above-the-fold content (hero, LCP, LeadForm) must NOT be wrapped here.
 *   - The variant root component stays Server Component - this is imported as
 *     a leaf, the same pattern as TrustStrip or MapEmbed.
 */

import React, { useEffect, useRef } from 'react';

/** Allowed wrapper tags. Extend as needed; keep the union small to avoid TS complexity errors. */
type ValidTag = 'div' | 'section' | 'article' | 'aside' | 'li';

interface ScrollRevealProps {
  children: React.ReactNode;
  /** Extra classes to add alongside the scroll-reveal base class. */
  className?: string;
  /** Wrapper element tag. Defaults to 'div'. */
  as?: ValidTag;
  /** IntersectionObserver threshold (0–1). Default 0.1. */
  threshold?: number;
  /** CSS transition-delay in ms applied via inline style. Default 0. */
  delay?: number;
}

export function ScrollReveal({
  children,
  className,
  as: tag = 'div',
  threshold = 0.1,
  delay = 0,
}: ScrollRevealProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Respect reduced-motion preference: reveal immediately, skip observer.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      el.classList.add('is-revealed');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add('is-revealed');
            observer.unobserve(el);
          }
        }
      },
      { threshold },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  const style: React.CSSProperties = delay > 0 ? { transitionDelay: `${delay}ms` } : {};
  const combinedClass = ['scroll-reveal', className].filter(Boolean).join(' ');

  // Use createElement to avoid TS union-complexity errors from a dynamic JSX tag.
  return React.createElement(
    tag,
    { ref, className: combinedClass, style },
    children,
  );
}
