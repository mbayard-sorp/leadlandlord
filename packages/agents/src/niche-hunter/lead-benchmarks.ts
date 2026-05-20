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
 * Neutral lead benchmark price (USD) returned when no trade matches.
 * Represents a mid-range home-services lead where we have no specific data.
 */
const DEFAULT_LEAD_BENCHMARK_PRICE = 45;

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

/**
 * Return the midpoint lead benchmark price (USD) for the given niche string.
 *
 * Uses the same substring-matching logic as getRentabilityPrior: case-insensitive,
 * longest-keyword-wins. Returns DEFAULT_LEAD_BENCHMARK_PRICE (45) when no trade
 * matches — a neutral midpoint representative of the broader home-services market.
 */
export function getLeadBenchmarkPrice(niche: string): number {
  const lower = niche.toLowerCase();

  let best: { keywordLength: number; price: number } | null = null;

  for (const benchmark of TRADE_BENCHMARKS) {
    for (const keyword of benchmark.keywords) {
      if (lower.includes(keyword)) {
        const midpoint = (benchmark.leadPriceRangeLow + benchmark.leadPriceRangeHigh) / 2;
        if (best === null || keyword.length > best.keywordLength) {
          best = { keywordLength: keyword.length, price: midpoint };
        }
      }
    }
  }

  return best?.price ?? DEFAULT_LEAD_BENCHMARK_PRICE;
}

/**
 * Default CPC ceiling (USD) used to normalize the willingness-to-pay sub-score.
 * Operator-overridable via system_state (ADR 0009 Task B).
 */
export const DEFAULT_RENTABILITY_CPC_CEILING = 12;

/**
 * Default lead-price ceiling (USD) used to normalize the lead-price sub-score.
 * Operator-overridable via system_state (ADR 0009 Task B).
 */
export const DEFAULT_RENTABILITY_LEAD_PRICE_CEILING = 100;

export interface RentabilityScoreInputs {
  /** Number of contractors returned by Places Text Search (first page, max 20). */
  contractor_count: number;
  /** Average CPC from DataForSEO keyword metrics (0 when unavailable). */
  avg_cpc: number;
  /** Midpoint lead price from static benchmarks (USD). */
  lead_benchmark_price: number;
  /**
   * CPC ceiling (USD) for the willingness-to-pay sub-score. Omit to use
   * DEFAULT_RENTABILITY_CPC_CEILING (12). Operator-overridable (Task B).
   */
  cpc_ceiling?: number;
  /**
   * Lead-price ceiling (USD) for the lead-price sub-score. Omit to use
   * DEFAULT_RENTABILITY_LEAD_PRICE_CEILING (100). Operator-overridable (Task B).
   */
  lead_price_ceiling?: number;
}

/**
 * Compute a 0..100 rentability score independently of the SEO winnability score.
 *
 * ADR 0009 Phase 2 / C1. This score is stored in `niches.rentability_score`
 * and displayed alongside `score` (SEO winnability) so operators can evaluate
 * both dimensions independently.
 *
 * Formula rationale (v1 heuristic, tunable):
 *
 * 1. Supply sub-score (weight 0.50): rewards a healthy-but-not-saturated
 *    contractor market. Too few contractors (<3) means almost no one to rent to;
 *    a moderate count (5-15) is ideal; very high (>=20, i.e. a full first page)
 *    signals saturation and is penalized. We model this with a tent curve:
 *      - 0..2:   score scales linearly from 0 to 0.40 (thin market)
 *      - 3..14:  score scales linearly from 0.40 to 1.0 (sweet spot peaks at 14)
 *      - 15..20: score scales linearly from 1.0 down to 0.30 (saturation)
 *    The curve is intentionally asymmetric — saturation is less bad than a
 *    completely empty market, but we still discount it materially.
 *
 * 2. CPC sub-score (weight 0.25): advertisers paying higher CPCs are signalling
 *    that leads convert and the job value justifies ad spend. We normalize
 *    against the CPC ceiling ($12 default, operator-overridable).
 *    Formula: min(1, avg_cpc / cpc_ceiling).
 *
 * 3. Lead price sub-score (weight 0.25): higher benchmark lead prices mean
 *    contractors in this trade are already conditioned to pay for leads.
 *    We normalize against the lead-price ceiling ($100 default, overridable).
 *    Formula: min(1, lead_benchmark_price / lead_price_ceiling).
 *
 * All three sub-scores are in [0, 1]; the weighted sum is multiplied by 100.
 */
export function computeRentabilityScore(inputs: RentabilityScoreInputs): number {
  const {
    contractor_count,
    avg_cpc,
    lead_benchmark_price,
    cpc_ceiling = DEFAULT_RENTABILITY_CPC_CEILING,
    lead_price_ceiling = DEFAULT_RENTABILITY_LEAD_PRICE_CEILING,
  } = inputs;

  // Sub-score 1: supply curve (tent, peaks at count=14, weight 0.50)
  const count = Math.max(0, Math.min(20, contractor_count));
  let supplySub: number;
  if (count <= 2) {
    // 0..2: thin market. Scale 0 -> 0.40 linearly.
    supplySub = (count / 2) * 0.4;
  } else if (count <= 14) {
    // 3..14: sweet spot. Scale 0.40 -> 1.0 linearly.
    supplySub = 0.4 + ((count - 2) / 12) * 0.6;
  } else {
    // 15..20: saturation. Scale 1.0 -> 0.30 linearly.
    supplySub = 1.0 - ((count - 14) / 6) * 0.7;
  }

  // Sub-score 2: CPC willingness-to-pay signal (weight 0.25)
  // CPCs at/above the ceiling are treated as max signal.
  const cpcSub = cpc_ceiling > 0 ? Math.min(1, avg_cpc / cpc_ceiling) : 0;

  // Sub-score 3: static lead-price benchmark (weight 0.25)
  // Lead prices at/above the ceiling get max signal.
  const leadPriceSub =
    lead_price_ceiling > 0 ? Math.min(1, lead_benchmark_price / lead_price_ceiling) : 0;

  const raw = supplySub * 0.5 + cpcSub * 0.25 + leadPriceSub * 0.25;
  return Math.min(100, Math.max(0, raw * 100));
}
