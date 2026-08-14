'use client';

import { useEffect, useRef, useState } from 'react';
import type { CsTestimonialItem } from '@/lib/customsites-sanity';

interface Props {
  items: CsTestimonialItem[];
  autoRotate?: boolean | null;
}

/** Rotating testimonial quote with dot navigation. Auto-rotates when
 * `autoRotate` is set, pausing on hover/focus and respecting
 * prefers-reduced-motion. Client component — the one genuinely interactive
 * piece of TestimonialsBlock. */
export function TestimonialsCarousel({ items, autoRotate }: Props) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  /* Set by the pause button and by any dot press. Distinct from `paused`,
     which is the transient hover/focus pause — once a user has explicitly
     stopped the rotation it must stay stopped (WCAG 2.2.2), where moving the
     pointer away should resume it. */
  const [stopped, setStopped] = useState(false);
  /* Announce quotes only when the user changed them. An unattended
     aria-live region on a 6s timer narrates a new quote to screen reader
     users every six seconds for as long as the section is on screen. */
  const [userDriven, setUserDriven] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const rotating = Boolean(autoRotate) && items.length > 1 && !stopped;

  useEffect(() => {
    if (!rotating || paused) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const id = setInterval(() => {
      setIndex((i) => (i + 1) % items.length);
    }, 6000);
    return () => clearInterval(id);
  }, [rotating, paused, items.length]);

  function show(i: number) {
    setIndex(i);
    setUserDriven(true);
    setStopped(true);
  }

  if (items.length === 0) return null;
  const current = items[index]!;

  return (
    <div
      ref={containerRef}
      className="cs-testimonials"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* aria-live, not a tabs pattern — there's exactly one quote visible at
          a time and no tabpanels, so a polite live region announces each
          rotation instead of `role="tablist"`/`"tab"`, which doesn't apply
          here. Live only once the user is driving: an unattended timer
          firing into a polite region is an interruption, not information. */}
      <div aria-live={userDriven ? 'polite' : 'off'} aria-atomic="true">
        {/* Keyed on the index so React swaps the node rather than mutating it
            in place — that remount is what replays the cs-quote-in animation
            and turns the slide change from a hard cut into a cross-fade. */}
        <div key={index} className="cs-testimonial-slide">
          <blockquote className="cs-testimonial-quote">&ldquo;{current.quote}&rdquo;</blockquote>
          {current.author ? (
            <p className="cs-testimonial-author">
              {current.author}
              {current.role ? `, ${current.role}` : ''}
            </p>
          ) : null}
        </div>
      </div>
      {items.length > 1 ? (
        <div className="cs-testimonial-controls">
          <div className="cs-testimonial-dots" role="group" aria-label="Testimonials">
            {items.map((item, i) => (
              <button
                key={item._id}
                type="button"
                className="cs-testimonial-dot"
                aria-current={i === index}
                aria-label={`Show testimonial ${i + 1} of ${items.length}`}
                onClick={() => show(i)}
              />
            ))}
          </div>
          {/* WCAG 2.2.2: auto-advancing content that starts on its own and
              runs longer than 5s needs a mechanism to stop it. The existing
              hover/focus pause covers pointer and keyboard but gives touch
              users nothing. */}
          {autoRotate && items.length > 1 ? (
            <button
              type="button"
              className="cs-testimonial-playpause"
              aria-label={stopped ? 'Resume testimonial rotation' : 'Pause testimonial rotation'}
              onClick={() => setStopped((s) => !s)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false">
                {stopped ? (
                  <path d="M4 2.5v11l9-5.5-9-5.5z" fill="currentColor" />
                ) : (
                  <path d="M4 2.5h3v11H4v-11zm5 0h3v11H9v-11z" fill="currentColor" />
                )}
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
