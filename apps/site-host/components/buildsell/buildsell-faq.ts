/**
 * Resting-state resolution for the FAQ accordion. Kept out of FaqBlock.tsx so
 * it is unit-testable without a JSX transform — mirrors buildsell-jsonld.ts.
 */

/** The three settings offered by the `defaultOpen` selector on bsFaqSection. */
export type FaqDefaultOpen = 'first' | 'all' | 'none';

/**
 * Narrows the raw Sanity value to a known setting. Anything unrecognised —
 * absent (docs written before the field existed), empty string (portal
 * "unset"), or a stale value — falls back to 'first', the behaviour the
 * block shipped with.
 */
export function resolveFaqDefaultOpen(value: unknown): FaqDefaultOpen {
  return value === 'all' || value === 'none' ? value : 'first';
}

/** Whether the item at `index` renders with the `open` attribute set. */
export function isFaqItemOpen(index: number, defaultOpen: FaqDefaultOpen): boolean {
  if (defaultOpen === 'all') return true;
  if (defaultOpen === 'none') return false;
  return index === 0;
}
