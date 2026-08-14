'use client';

import { useId, useState } from 'react';
import Image from 'next/image';

interface BeforeAfterSliderProps {
  beforeUrl: string;
  afterUrl: string;
  beforeAlt: string;
  afterAlt: string;
  beforeLabel: string;
  afterLabel: string;
  /** CSS aspect-ratio value, e.g. "4/3". Locks the frame so nothing shifts on load. */
  aspect: string;
  /** Used in the slider's accessible name so multiple galleries stay distinguishable. */
  title?: string | null;
  /** True for the first pair in the gallery — that one is eager-loaded. */
  priority?: boolean;
}

function HandleGrip() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="10 6 5 12 10 18" />
      <polyline points="14 6 19 12 14 18" />
    </svg>
  );
}

/**
 * Drag-to-reveal comparison frame. The "after" photo is the base layer and the
 * "before" photo sits on top, clipped to the slider position.
 *
 * The control is a real `<input type="range">` stretched over the whole frame
 * and made invisible. That is deliberate: it gives us touch dragging, click-to-
 * jump, arrow-key stepping, and a screen-reader-announced value for free, with
 * no pointer-event bookkeeping and no dependency on hover. The visible divider
 * and handle are painted from the `--bs-ba-pos` custom property, and the focus
 * ring is drawn on the handle via `:has()` on the frame.
 */
export function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  beforeAlt,
  afterAlt,
  beforeLabel,
  afterLabel,
  aspect,
  title,
  priority = false,
}: BeforeAfterSliderProps) {
  const [pos, setPos] = useState(50);
  const labelId = useId();

  const sizes = '(max-width: 599px) 100vw, (max-width: 1023px) 90vw, 560px';

  return (
    <div
      className="bs-ba-frame"
      style={
        {
          aspectRatio: aspect,
          '--bs-ba-pos': `${pos}%`,
        } as React.CSSProperties
      }
    >
      {/* Base layer: the finished work */}
      <Image
        className="bs-ba-img"
        src={afterUrl}
        alt={afterAlt}
        fill
        sizes={sizes}
        priority={priority}
        style={{ objectFit: 'cover' }}
      />

      {/* Overlay: the original state, clipped to the slider position */}
      <div className="bs-ba-clip">
        <Image
          className="bs-ba-img"
          src={beforeUrl}
          alt={beforeAlt}
          fill
          sizes={sizes}
          priority={priority}
          style={{ objectFit: 'cover' }}
        />
      </div>

      <span className="bs-ba-chip bs-ba-chip--before" aria-hidden="true">
        {beforeLabel}
      </span>
      <span className="bs-ba-chip bs-ba-chip--after" aria-hidden="true">
        {afterLabel}
      </span>

      <div className="bs-ba-divider" aria-hidden="true">
        <span className="bs-ba-handle">
          <HandleGrip />
        </span>
      </div>

      <label className="bs-ba-srlabel" id={labelId} htmlFor={`${labelId}-range`}>
        {title
          ? `Reveal slider — ${title}. Drag to compare ${beforeLabel.toLowerCase()} and ${afterLabel.toLowerCase()}.`
          : `Reveal slider. Drag to compare ${beforeLabel.toLowerCase()} and ${afterLabel.toLowerCase()}.`}
      </label>
      <input
        id={`${labelId}-range`}
        className="bs-ba-range"
        type="range"
        min={0}
        max={100}
        step={1}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-labelledby={labelId}
        aria-valuetext={`${pos}% ${beforeLabel.toLowerCase()}, ${100 - pos}% ${afterLabel.toLowerCase()}`}
      />
    </div>
  );
}
