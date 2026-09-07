import type { BuildSellSection } from '@/lib/sanity';

/** Falls back to a metro-wide view — close enough to read street names, wide enough to show the area. */
const DEFAULT_ZOOM = 11;

/**
 * Reduce a prose service area to something a map can actually resolve.
 *
 * Generated service areas read like "San Tan Valley and surrounding East Valley
 * communities including Goodyear, Tolleson, and Litchfield Park" — the leading
 * segment is the real place and the rest is copy that derails geocoding. Take
 * the head, then qualify it with the state so "Glendale" lands in the right one.
 */
export function serviceAreaToMapQuery(serviceArea: string, state?: string | null): string {
  const head = serviceArea.split(/\s+and\s+/i)[0]!.replace(/[,;:.]\s*$/, '').trim();
  const place = head || serviceArea.trim();
  const st = state?.trim();
  if (!st) return place;
  // Already qualified ("Tucson, AZ") — don't double it up.
  if (new RegExp(`\\b${st.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(place)) return place;
  return `${place}, ${st}`;
}

/**
 * Resolve what the contact map centers on, most specific override first:
 * an explicit Map Location, then the Service Area, then the street address,
 * then City + State. Returns null when there is nothing to geocode.
 */
export function resolveMapQuery(section: BuildSellSection): string | null {
  const addr = section.address;

  const explicit = section.mapQuery?.trim();
  if (explicit) return explicit;

  const serviceArea = addr?.serviceArea?.trim();
  if (serviceArea) return serviceAreaToMapQuery(serviceArea, addr?.state);

  const street = addr?.street?.trim();
  if (street) return [street, addr?.city, addr?.state, addr?.zip].filter(Boolean).join(', ');

  const cityLine = [addr?.city, addr?.state].filter(Boolean).join(', ').trim();
  return cityLine || null;
}

/**
 * Build the Google Maps embed URL for the contact block.
 *
 * With NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY set we use the documented Embed API,
 * which is the supported, stable surface. Without a key we fall back to the
 * keyless `output=embed` form so a site with zero configuration still renders a
 * real map — that endpoint is undocumented and could change without notice, so
 * set the key for anything long-lived.
 */
export function buildMapEmbedUrl(section: BuildSellSection): string | null {
  const query = resolveMapQuery(section);
  if (!query) return null;

  const zoom = section.mapZoom ?? DEFAULT_ZOOM;
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY;

  if (key) {
    return `https://www.google.com/maps/embed/v1/place?${new URLSearchParams({ key, q: query, zoom: String(zoom) })}`;
  }
  return `https://www.google.com/maps?${new URLSearchParams({ q: query, z: String(zoom), output: 'embed' })}`;
}
