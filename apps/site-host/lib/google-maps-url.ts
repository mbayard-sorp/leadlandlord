/**
 * Build a Google Maps search URL for a business. Returns null when placeId is
 * absent so callers can safely omit the link / sameAs entirely.
 *
 * The URL uses the Places search endpoint (not the embed or directions API):
 * https://developers.google.com/maps/documentation/urls/get-started#search-action
 *
 * We construct the URL at render time from operator-supplied data only.
 * Never accepts user-input image URLs or PII beyond what the operator stored.
 */
export function googleMapsUrl(businessName: string, placeId: string | null | undefined): string | null {
  if (!placeId) return null;
  const params = new URLSearchParams({
    api: '1',
    query: businessName,
    query_place_id: placeId,
  });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}
