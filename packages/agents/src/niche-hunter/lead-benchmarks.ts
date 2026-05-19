/**
 * Static per-trade lead-price benchmarks and rentability priors.
 *
 * ADR 0009 Phase 1 / A3. Zero API cost — pure static data.
 *
 * `rentabilityPrior` is a 0..1 value representing how willing contractors
 * in this trade are likely to pay for leads relative to other trades:
 *   - 0.9  : very high ticket, low supply in most markets, contractors routinely
 *            pay $80-150/lead (roofing, HVAC, foundation repair)
 *   - 0.7  : solid ticket, moderate competition, $40-80/lead (plumbing, electrical,
 *            tree service, fencing)
 *   - 0.5  : neutral (default — unknown niche or mid-range market)
 *   - 0.3  : lower-ticket, often quoted phone-first, harder to convert to recurring
 *            (pressure washing, junk removal, painting)
 *
 * These priors are NOT derived from live data. They represent market intuition
 * seeded from industry lead-cost benchmarks and will be revised once we have
 * 30+ operator validation cycles (ADR 0009 Phase 2).
 *
 * Matching is case-insensitive substring: "residential roofing" matches "roofing".
 * Longest matching keyword wins to avoid "plumbing" swallowing "plumbing inspection".
 */

interface TradeBenchmark {
  /** Substring(s) to match against the niche string (lowercase). */
  keywords: string[];
  /** Lead price range in USD (informational; not used in scoring directly). */
  leadPriceRangeLow: number;
  leadPriceRangeHigh: number;
  /**
   * Rentability prior: 0..1. Used as an additive sub-score in computeScore
   * (weight 0.05). 0.5 is neutral and matches the default.
   */
  rentabilityPrior: number;
}

const TRADE_BENCHMARKS: TradeBenchmark[] = [
  {
    keywords: ['roof', 'roofing', 'shingle'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 150,
    rentabilityPrior: 0.9,
  },
  {
    keywords: ['hvac', 'air conditioning', 'furnace', 'heat pump', 'ac repair', 'ac install'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 120,
    rentabilityPrior: 0.9,
  },
  {
    keywords: ['foundation repair', 'foundation crack', 'basement waterproof'],
    leadPriceRangeLow: 80,
    leadPriceRangeHigh: 140,
    rentabilityPrior: 0.88,
  },
  {
    keywords: ['plumbing', 'plumber', 'drain', 'sewer', 'water heater'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.78,
  },
  {
    keywords: ['electrical', 'electrician', 'panel upgrade', 'rewiring'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 90,
    rentabilityPrior: 0.75,
  },
  {
    keywords: ['tree removal', 'tree service', 'tree trim', 'stump grinding', 'stump removal'],
    leadPriceRangeLow: 40,
    leadPriceRangeHigh: 80,
    rentabilityPrior: 0.72,
  },
  {
    keywords: ['fencing', 'fence install', 'fence repair', 'fence contractor'],
    leadPriceRangeLow: 40,
    leadPriceRangeHigh: 75,
    rentabilityPrior: 0.70,
  },
  {
    keywords: ['gutter', 'gutter cleaning', 'gutter guard', 'gutter install'],
    leadPriceRangeLow: 30,
    leadPriceRangeHigh: 60,
    rentabilityPrior: 0.60,
  },
  {
    keywords: ['concrete', 'concrete patio', 'concrete driveway', 'concrete repair'],
    leadPriceRangeLow: 40,
    leadPriceRangeHigh: 80,
    rentabilityPrior: 0.65,
  },
  {
    keywords: ['painting', 'house painting', 'interior paint', 'exterior paint'],
    leadPriceRangeLow: 30,
    leadPriceRangeHigh: 60,
    rentabilityPrior: 0.40,
  },
  {
    keywords: ['pressure washing', 'power washing', 'soft wash'],
    leadPriceRangeLow: 20,
    leadPriceRangeHigh: 45,
    rentabilityPrior: 0.32,
  },
  {
    keywords: ['junk removal', 'junk hauling', 'debris removal'],
    leadPriceRangeLow: 20,
    leadPriceRangeHigh: 40,
    rentabilityPrior: 0.30,
  },
  {
    keywords: ['window replacement', 'window install', 'window repair'],
    leadPriceRangeLow: 50,
    leadPriceRangeHigh: 100,
    rentabilityPrior: 0.73,
  },
  {
    keywords: ['insulation', 'spray foam', 'blown-in'],
    leadPriceRangeLow: 40,
    leadPriceRangeHigh: 80,
    rentabilityPrior: 0.68,
  },
  {
    keywords: ['mold remediation', 'mold removal', 'mold inspection'],
    leadPriceRangeLow: 60,
    leadPriceRangeHigh: 110,
    rentabilityPrior: 0.80,
  },
];

/** Neutral prior returned when no trade matches. */
const DEFAULT_RENTABILITY_PRIOR = 0.5;

/**
 * Return a rentability prior (0..1) for the given niche string.
 *
 * Matching: case-insensitive, substring. When multiple benchmark entries
 * match, the one with the longest matching keyword wins, giving more specific
 * entries precedence over broad ones (e.g. "foundation repair" over "repair").
 *
 * Returns DEFAULT_RENTABILITY_PRIOR (0.5) when no trade matches.
 */
export function getRentabilityPrior(niche: string): number {
  const lower = niche.toLowerCase();

  let best: { keywordLength: number; prior: number } | null = null;

  for (const benchmark of TRADE_BENCHMARKS) {
    for (const keyword of benchmark.keywords) {
      if (lower.includes(keyword)) {
        if (best === null || keyword.length > best.keywordLength) {
          best = { keywordLength: keyword.length, prior: benchmark.rentabilityPrior };
        }
      }
    }
  }

  return best?.prior ?? DEFAULT_RENTABILITY_PRIOR;
}
