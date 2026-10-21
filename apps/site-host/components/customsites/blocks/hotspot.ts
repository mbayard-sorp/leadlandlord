import type { CsImageHotspot } from '@/lib/customsites-sanity';

/** Sanity hotspot centre (0 to 1) as a CSS object-position, or undefined when
 *  the editor never set one so the browser default (centre) applies. */
export function hotspotPosition(hotspot?: CsImageHotspot | null): string | undefined {
  if (!hotspot) return undefined;
  return `${hotspot.x * 100}% ${hotspot.y * 100}%`;
}
