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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoRotate || paused || items.length <= 1) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const id = setInterval(() => {
      setIndex((i) => (i + 1) % items.length);
    }, 6000);
    return () => clearInterval(id);
  }, [autoRotate, paused, items.length]);

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
      <blockquote className="cs-testimonial-quote">&ldquo;{current.quote}&rdquo;</blockquote>
      {current.author ? (
        <p className="cs-testimonial-author">
          {current.author}
          {current.role ? `, ${current.role}` : ''}
        </p>
      ) : null}
      {items.length > 1 ? (
        <div className="cs-testimonial-dots" role="tablist" aria-label="Testimonials">
          {items.map((item, i) => (
            <button
              key={item._id}
              type="button"
              role="tab"
              className="cs-testimonial-dot"
              aria-current={i === index}
              aria-label={`Show testimonial ${i + 1} of ${items.length}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
