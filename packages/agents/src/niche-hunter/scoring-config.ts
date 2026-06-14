/**
 * Legacy-score weights + demand resolution shared by computeScore callers
 * (validateNicheCore and the operator UI). Slimmed 2026-06-12 (ADR 0020):
 * the brainstorm-era ScoringConfig thresholds (min_search_volume, max_kd,
 * min_avg_job_value_usd) and GEO_SHARE_PRIOR are gone with the legacy
 * NicheHunter agent — the scout/validate engine ranks by dollar value
 * (value-model.ts) instead of threshold filters.
 */

// ── Scout scoring floor + dampening constants (ADR 0021) ────────────────────

/**
 * Hard floor on lead benchmark price (USD). Trades resolving below this value
 * are dropped before scoring — they can't sustain a recurring rent fee.
 * Operator-overridable via system_state.scout_min_lead_price.
 */
export const MIN_LEAD_BENCHMARK_PRICE = 50;

/**
 * Hard floor on rentability prior. Trades resolving below this value are
 * dropped before scoring. Combined with MIN_LEAD_BENCHMARK_PRICE, this gates
 * the $45/0.50 default bucket out cleanly while keeping every mapped KEEP trade.
 * Operator-overridable via system_state.scout_min_rentability_prior.
 */
export const MIN_RENTABILITY_PRIOR = 0.60;

/**
 * Population anchor for the sqrt volume dampening formula (ADR 0021).
 * A city of exactly this size is unchanged vs. the old linear formula;
 * larger cities are compressed. Value of 100k keeps the 100k city as the
 * neutral pivot — matching the middle of the scout's default pop range.
 */
export const POP_DAMPENING_REFERENCE = 100_000;

/**
 * Winnability fallback when no usable kd values exist in the cluster
 * (all kd <= 0). Conservative: an uncached trade should not get an
 * assumed-easy SERP that lets it leapfrog measured-hard trades.
 */
export const DEFAULT_BENCHMARK_WINNABILITY = 0.5;

// ── Scout geographic targeting blend strengths (ADR 0022) ───────────────────

/**
 * Blend strength (α_comp) folding the structural metro-density competition
 * proxy into winnability. Shipped at 0.0 so the feature is inert: at α=0,
 * localRankMult = 1.0 and scout output reproduces the ADR 0021 formula
 * bit-for-bit. Operator-overridable via system_state.scout_geo_comp_blend;
 * suggested starting value 0.3–0.5 once the geo-tier report is observed.
 */
export const DEFAULT_GEO_COMP_BLEND = 0.0;

/**
 * Blend strength (α_dem) folding Census-derived demand quality into estimated
 * monthly value. Shipped at 0.0 so the feature is inert: at α=0,
 * demandMult = 1.0 and scout output reproduces the ADR 0021 formula
 * bit-for-bit. Operator-overridable via system_state.scout_geo_demand_blend;
 * suggested starting value 0.3–0.5 once the geo-tier report is observed.
 */
export const DEFAULT_GEO_DEMAND_BLEND = 0.0;

// ── Scout Stage-3 local-SERP refinement budget (ADR 0022 §5) ────────────────

/**
 * In-run DataForSEO budget cap (USD) for the bounded local-SERP refinement
 * pass. ~13 cold trios at $0.225 each, far more on a warm cache. The per-agent
 * and global caps only fire at run start, so this in-run guard is the real
 * bound on refinement spend. Operator-overridable per-run (ScoutForm) or
 * globally via system_state.scout_refine_budget_usd.
 */
export const DEFAULT_SCOUT_REFINE_BUDGET_USD = 3.00;

/**
 * Number of top-scoring cells fed to the local-SERP refinement pass. Shipped
 * at 0 so Stage 3 is disabled by default: no refinement, no DataForSEO spend.
 * An operator must set a positive scout_refine_top_k (per-run via ScoutForm or
 * globally via system_state) before any refinement spend can occur.
 */
export const DEFAULT_SCOUT_REFINE_TOP_K = 0;

// ── Candidate diversity caps (ADR 0023) ─────────────────────────────────────
//
// The scout ranks the whole trade x city grid by a single dollar score and
// keeps the top N. With no spread constraint, whichever trade has the highest
// leadBenchmarkPrice x rentabilityPrior sweeps every city — legal trades
// (PI lawyer $650 x 0.92 ≈ 6x a roofer per unit volume) filled an entire run.
// These caps bound how much of the persisted set any one trade or category can
// occupy, so the value ranking still orders candidates but a single mono-trade
// or mono-category can no longer monopolize the list. Both are operator-tunable
// via system_state (scout_max_per_trade, scout_max_category_share).

/**
 * Max cities (candidates) any single trade may contribute to the persisted set.
 * Caps "personal injury lawyer in 200 cities" down to a handful so other trades
 * surface. Operator-overridable via system_state.scout_max_per_trade.
 */
export const SCOUT_MAX_PER_TRADE = 8;

/**
 * Max fraction of the persisted set any single category may occupy. With 9
 * categories, 0.30 lets the strongest category take up to ~a third while still
 * leaving room for the rest. Resolved to an absolute count against persist_top
 * at selection time. Operator-overridable via system_state.scout_max_category_share.
 * Ignored when the run is already scoped to one category (category_filter set).
 */
export const SCOUT_MAX_CATEGORY_SHARE = 0.30;

export const DEFAULT_WEIGHTS = {
  demand: 0.30,
  serp_difficulty: 0.30,
  ad_presence: 0.20,
  city_size_fit: 0.15,
  niche_risk: 0.05,
} as const;

export type ScoringWeights = {
  demand: number;
  serp_difficulty: number;
  ad_presence: number;
  city_size_fit: number;
  niche_risk: number;
};

/**
 * Minimum DataForSEO measured volume required to trust the DFS figure over
 * the estimate. Below this threshold Google Ads Keyword Planner buckets
 * hyperlocal city x phrase queries to ~10, providing zero dynamic range.
 */
export const DFS_TRUST_FLOOR = 100;

/**
 * Volume at which computeScore's demand sub-score saturates to 1.0.
 * demandSub = Math.min(1, Math.log10(volume+1)/4) — log10(10001) >= 4 -> 1.0.
 * Documented here so callers understand why feeding values >> 10,000 is wasteful.
 */
export const DEMAND_SUB_SATURATION_CEILING = 10_000;

/**
 * Resolve the demand volume to feed into scoring.
 *
 * Rule: use the DataForSEO measured figure when it meets the trust floor;
 * otherwise fall back to the row's estimate (Claude midpoint on legacy rows,
 * scout est city volume on promoted candidates). Single source of truth for
 * demand resolution — validateNicheCore, estimateValidatedValue, and the
 * operator UI all call this.
 */
export function resolveDemandVolume(
  dfsVolume: number,
  claudeMid: number,
): { volume: number; source: 'dataforseo' | 'claude_estimate' } {
  if (dfsVolume >= DFS_TRUST_FLOOR) {
    return { volume: dfsVolume, source: 'dataforseo' };
  }
  return { volume: claudeMid, source: 'claude_estimate' };
}
