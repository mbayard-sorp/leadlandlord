import { subtypeFor } from '@/components/shared/local-business-schema';
import { googleMapsUrl } from '@/lib/google-maps-url';
import type { BuildSellSite, BuildSellSection } from '@/lib/sanity';

interface BuildSellLocalBusinessJsonLdProps {
  site: BuildSellSite;
  /** Canonical public URL for this spec site, e.g. https://example.com/buildsell/abc-plumbing-phoenix-az-abc123 */
  url: string;
}

// ---------------------------------------------------------------------------
// Opening hours parser
// ---------------------------------------------------------------------------

/**
 * Day-range tokens we recognise. Sanity field is operator free text; we
 * handle the most common formats and silently skip anything exotic.
 */
const DAY_MAP: Record<string, string> = {
  monday: 'Monday', mon: 'Monday',
  tuesday: 'Tuesday', tue: 'Tuesday', tues: 'Tuesday',
  wednesday: 'Wednesday', wed: 'Wednesday',
  thursday: 'Thursday', thu: 'Thursday', thur: 'Thursday', thurs: 'Thursday',
  friday: 'Friday', fri: 'Friday',
  saturday: 'Saturday', sat: 'Saturday',
  sunday: 'Sunday', sun: 'Sunday',
};

const SCHEMA_DAY: string[] = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

/** Convert e.g. "7am", "7:30am", "19:00" to "HH:MM". Returns null on failure. */
function parseTime(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  // 24-hour: "14:00"
  const h24 = t.match(/^(\d{1,2}):(\d{2})$/);
  if (h24 !== null) {
    const h = parseInt(h24[1] ?? '0', 10);
    const m = parseInt(h24[2] ?? '0', 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    return null;
  }
  // 12-hour: "7am", "7:30pm", "noon"
  if (t === 'noon') return '12:00';
  if (t === 'midnight') return '00:00';
  const h12 = t.match(/^(\d{1,2})(?::(\d{2}))?([ap]m)$/);
  if (h12 !== null) {
    let h = parseInt(h12[1] ?? '0', 10);
    const m = parseInt(h12[2] ?? '0', 10);
    const ampm = h12[3] ?? '';
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }
  return null;
}

/** Resolve a day abbreviation/name to its Schema.org label. */
function parseDay(raw: string): string | null {
  return DAY_MAP[raw.trim().toLowerCase()] ?? null;
}

/**
 * Expand a day range like "Mon–Fri" or "Mon-Fri" to an array of Schema.org day names.
 * Single day "Mon" returns ["Monday"].
 */
function expandDayRange(raw: string): string[] {
  // Split on en-dash, em-dash, or hyphen.
  const parts = raw.split(/[–—-]/).map((p) => p.trim());
  const first = parts[0] ?? '';
  if (parts.length === 1) {
    const d = parseDay(first);
    return d ? [d] : [];
  }
  if (parts.length === 2) {
    const second = parts[1] ?? '';
    const start = parseDay(first);
    const end = parseDay(second);
    if (!start || !end) return [];
    const si = SCHEMA_DAY.indexOf(start);
    const ei = SCHEMA_DAY.indexOf(end);
    if (si === -1 || ei === -1) return [];
    // Handle wrap-around (e.g. Sat–Mon)
    if (si <= ei) return SCHEMA_DAY.slice(si, ei + 1);
    return [...SCHEMA_DAY.slice(si), ...SCHEMA_DAY.slice(0, ei + 1)];
  }
  return [];
}

interface OpeningHoursEntry {
  '@type': 'OpeningHoursSpecification';
  dayOfWeek: string[];
  opens: string;
  closes: string;
}

/**
 * Parse a free-text hours string into OpeningHoursSpecification entries.
 *
 * Patterns handled:
 *   "Mon–Sat 7am–6pm"
 *   "Mon-Fri 8:00am-5:00pm, Sat 9am-2pm"
 *   "Open 24/7"
 *   "Monday–Friday 7am–6pm; Saturday 8am–2pm"
 *
 * Returns [] when the string cannot be parsed — callers must not emit
 * the field when the array is empty.
 */
function parseOpeningHours(hours: string): OpeningHoursEntry[] {
  const text = hours.trim();

  // "Open 24/7" / "24/7" / "24 hours" / "always open"
  if (/24\s*\/\s*7|24\s*hours|always\s*open/i.test(text)) {
    return SCHEMA_DAY.map((day) => ({
      '@type': 'OpeningHoursSpecification' as const,
      dayOfWeek: [day],
      opens: '00:00',
      closes: '23:59',
    }));
  }

  // Split on comma or semicolon to get segments like "Mon–Sat 7am–6pm"
  const segments = text.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const results: OpeningHoursEntry[] = [];

  for (const seg of segments) {
    // Pattern: <days> <open>–<close>
    // e.g. "Mon–Sat 7am–6pm", "Mon-Fri 8:00am-5:00pm"
    const m = seg.match(
      /^([A-Za-z–—\-\s]+?)\s+(\S+)\s*[–—-]\s*(\S+)$/,
    );
    if (m === null) continue;

    const daysPart = m[1]?.trim() ?? '';
    const opensRaw = m[2]?.trim() ?? '';
    const closesRaw = m[3]?.trim() ?? '';

    const days = expandDayRange(daysPart);
    const opens = parseTime(opensRaw);
    const closes = parseTime(closesRaw);

    if (days.length === 0 || opens === null || closes === null) continue;

    results.push({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: days,
      opens,
      closes,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helper: find a section by _type
// ---------------------------------------------------------------------------

function findSection(
  sections: BuildSellSection[] | null | undefined,
  type: string,
): BuildSellSection | undefined {
  return sections?.find((s) => s._type === type);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * LocalBusiness JSON-LD for a Build & Sell spec site.
 *
 * Uses the niche->subtype mapping from the R&R shared helper so trade-specific
 * subtypes (Plumber, HVACBusiness, etc.) are applied consistently.
 *
 * AggregateRating is emitted only when real Google Places aggregate data is
 * present (site.rating + site.reviewCount > 0). Individual Review objects are
 * never emitted.
 *
 * sameAs is populated only when place_id is available.
 */
export function BuildSellLocalBusinessJsonLd({ site, url }: BuildSellLocalBusinessJsonLdProps) {
  const schemaType = subtypeFor(site.trade);
  const mapsUrl = googleMapsUrl(site.businessName, site.placeId);

  // Resolve contact section address for hours/serviceArea (may differ from doc root).
  const contactSection = findSection(site.sections, 'bsContactSection');
  const addr = contactSection?.address;

  const heroSection = findSection(site.sections, 'bsHeroSection');
  const heroImageUrl = heroSection?.imageUrl;

  // --- areaServed ---
  let areaServed: unknown;
  if (addr?.serviceArea) {
    const tokens = addr.serviceArea
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const all = [site.city, ...tokens];
    // Deduplicate case-insensitively, preserve first occurrence casing.
    const seen = new Set<string>();
    const cities: Array<{ '@type': string; name: string }> = [];
    for (const t of all) {
      const key = t.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        cities.push({ '@type': 'City', name: t });
      }
    }
    areaServed = cities;
  } else {
    areaServed = { '@type': 'City', name: site.city };
  }

  // --- address ---
  const address: Record<string, string> = {
    '@type': 'PostalAddress',
    addressLocality: site.city,
    addressRegion: site.state,
    addressCountry: 'US',
  };
  if (addr?.street) address.streetAddress = addr.street;
  if (addr?.zip) address.postalCode = addr.zip;

  // --- openingHoursSpecification ---
  const openingHours = addr?.hours ? parseOpeningHours(addr.hours) : [];

  // --- aggregateRating ---
  const hasRating =
    typeof site.rating === 'number' &&
    typeof site.reviewCount === 'number' &&
    site.reviewCount > 0;

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    name: site.businessName,
    url,
    areaServed,
    address,
  };

  if (site.phone) ld.telephone = site.phone;
  if (mapsUrl) ld.sameAs = [mapsUrl];
  if (heroImageUrl) ld.image = heroImageUrl;
  if (openingHours.length > 0) ld.openingHoursSpecification = openingHours;
  if (hasRating) {
    ld.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: site.rating,
      reviewCount: site.reviewCount,
    };
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
    />
  );
}
