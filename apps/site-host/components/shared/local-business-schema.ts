/**
 * Pure schema.org helpers for <LocalBusinessJsonLd>. Kept out of the component
 * file so the niche→subtype mapping and the areaServed locality derivation are
 * unit-testable without a React/JSX transform.
 */

/**
 * Niche → schema.org subtype mapping per style guide §01 (SEO rules).
 * Defaults to LocalBusiness when no good match.
 *
 * Matching (see {@link subtypeFor}) is word-boundary aware, so the root tokens
 * "roof" / "tree" / "paint" catch the multi-word niches the Content Engine
 * emits ("roof replacement", "tree trimming", "interior paint") that the longer
 * derived keys ("roofing", "tree removal", "painting") miss — without a root
 * like "roof" leaking into an unrelated trade ("basement waterproofing").
 */
const NICHE_SUBTYPES: Record<string, string> = {
  plumbing: 'Plumber',
  plumber: 'Plumber',
  hvac: 'HVACBusiness',
  'air conditioning': 'HVACBusiness',
  heating: 'HVACBusiness',
  electrical: 'Electrician',
  electrician: 'Electrician',
  roof: 'RoofingContractor',
  roofing: 'RoofingContractor',
  roofer: 'RoofingContractor',
  shingle: 'RoofingContractor',
  paint: 'HousePainter',
  painting: 'HousePainter',
  painter: 'HousePainter',
  'house painter': 'HousePainter',
  cleaning: 'HouseCleaning',
  'house cleaning': 'HouseCleaning',
  maid: 'HouseCleaning',
  landscaping: 'LandscapingService',
  landscape: 'LandscapingService',
  tree: 'TreeService',
  'tree removal': 'TreeService',
  'tree service': 'TreeService',
  arborist: 'TreeService',
  pest: 'PestControlService',
  'pest control': 'PestControlService',
  locksmith: 'Locksmith',
  moving: 'MovingCompany',
  'junk removal': 'MovingCompany',
};

/**
 * Resolve a niche string to a schema.org LocalBusiness subtype.
 *
 * Tries an exact match first, then a word-boundary scan so a root token matches
 * the start of a word ("roof" → "roof replacement", "roofing") but never the
 * middle of one ("roof" ✗ "basement waterproofing"). Falls back to
 * "LocalBusiness".
 */
export function subtypeFor(niche: string): string {
  const key = niche.toLowerCase().trim();
  const exact = NICHE_SUBTYPES[key];
  if (exact) return exact;
  for (const [token, subtype] of Object.entries(NICHE_SUBTYPES)) {
    if (new RegExp(`\\b${token}`).test(key)) return subtype;
  }
  return 'LocalBusiness';
}

/**
 * Derive a clean locality (e.g. "Henderson, NV") from a Content Engine
 * service_area page title, for schema.org `areaServed`.
 *
 * Titles are LLM-authored and take a few shapes, none reliably "<x> in <city>":
 *   - "Junk Removal Henderson NV | Same-Day Service"
 *   - "Roof Replacement Owensboro KY | Smith Roofing"
 *   - "Plumbing in Henderson, NV"
 *   - "tree removal in Mesa"
 *
 * We must not leak the "| <marketing suffix>" tail or the leading service words
 * into the schema value. Returns "" when nothing locality-like remains (callers
 * filter empties).
 */
export function serviceAreaLocality(title: string, niche: string, state: string): string {
  // 1. Drop the "|"-delimited marketing suffix ("... | Same-Day Service").
  let locality = (title.split('|')[0] ?? '').trim();

  // 2. Prefer an explicit "<service> in <locality>" segment when present; the
  //    greedy prefix anchors on the LAST " in " so a service name containing
  //    "in" (e.g. "Walk In Tub") doesn't win over the real locality separator.
  const inMatch = locality.match(/^.*\bin\s+(.+)$/i);
  if (inMatch?.[1]) {
    locality = inMatch[1].trim();
  } else {
    // 3. No "in <city>": strip a leading copy of the niche so only the
    //    "<City> <ST>" tail remains ("Junk Removal Henderson NV" → "Henderson NV").
    const n = niche.trim().toLowerCase();
    if (n && locality.toLowerCase().startsWith(n)) {
      locality = locality.slice(n.length).trim();
    }
  }

  // 4. Normalize a trailing state token to ", ST" ("Henderson NV" → "Henderson, NV").
  locality = normalizeStateSuffix(locality, state);

  // 5. Collapse whitespace and trim stray separators.
  return locality.replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').trim();
}

/**
 * Normalize a trailing 2-letter state into ", ST" form. Only rewrites when the
 * trailing token matches the site's known state (or no state is known), so an
 * odd locality isn't mangled.
 */
function normalizeStateSuffix(locality: string, state: string): string {
  const st = state.trim().toUpperCase();
  const m = locality.match(/^(.*?)[\s,]+([A-Za-z]{2})$/);
  if (!m) return locality;
  const city = m[1]?.trim() ?? '';
  const abbr = (m[2] ?? '').toUpperCase();
  if (!city) return locality;
  if (st && abbr !== st) return locality;
  return `${city}, ${abbr}`;
}

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Hardcoded fallback used when the operator hasn't entered `opening_hours`. */
const DEFAULT_OPENING_HOURS = { opens: '07:00', closes: '21:00' };

/**
 * Build the `openingHoursSpecification` node for LocalBusiness JSON-LD.
 *
 * Uses the operator-entered `bundle.opening_hours` (opens/closes + optional
 * closedDays) when present, otherwise falls back to the hardcoded default
 * 07:00-21:00, all week.
 */
export function openingHoursSpecification(
  openingHours: { opens: string; closes: string; closed_days?: string[] } | undefined,
): Array<{ '@type': string; dayOfWeek: string[]; opens: string; closes: string }> {
  const { opens, closes } = openingHours ?? DEFAULT_OPENING_HOURS;
  const closedDays = new Set(openingHours?.closed_days ?? []);
  const dayOfWeek = ALL_DAYS.filter((d) => !closedDays.has(d));
  return [
    {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek,
      opens,
      closes,
    },
  ];
}

interface BundleCredential {
  name: string;
  issuer?: string;
  license_number?: string;
  url?: string;
}

interface CredentialNode {
  '@type': 'EducationalOccupationalCredential';
  credentialCategory: 'license' | 'certification';
  name: string;
  recognizedBy?: { '@type': 'Organization'; name: string };
  url?: string;
}

/**
 * Build the `hasCredential` nodes for LocalBusiness JSON-LD from
 * operator-entered `bundle.credentials` (ADR 0032 — operational Sanity
 * passthrough field, no ContentBundle equivalent). Returns an empty array
 * when no credentials are present, so callers can omit the property.
 *
 * Categorized as `license` when a `license_number` is present, otherwise
 * `certification`.
 */
export function hasCredential(credentials: BundleCredential[] | undefined): CredentialNode[] {
  if (!credentials || credentials.length === 0) return [];
  return credentials.map((c) => ({
    '@type': 'EducationalOccupationalCredential',
    credentialCategory: c.license_number ? 'license' : 'certification',
    name: c.name,
    ...(c.issuer ? { recognizedBy: { '@type': 'Organization', name: c.issuer } } : {}),
    ...(c.url ? { url: c.url } : {}),
  }));
}
