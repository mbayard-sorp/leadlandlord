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
 * Hard floor on proxy winnability. Trades whose MEASURED cluster difficulty
 * exceeds ~75 (i.e. (100 - kd) / 100 < 0.25) are dropped before scoring
 * because the SERP is too competitive to rank profitably. Benchmark-only /
 * unmeasured trades (clusterDifficulty null) are exempt — we simply lack
 * evidence they are hard. Operator-overridable via
 * system_state.scout_min_winnability.
 */
export const MIN_WINNABILITY_FLOOR = 0.25;

/**
 * Winnability fallback when no usable kd values exist in the cluster
 * (all kd <= 0). Conservative: an uncached trade should not get an
 * assumed-easy SERP that lets it leapfrog measured-hard trades.
 */
export const DEFAULT_BENCHMARK_WINNABILITY = 0.5;

// ── Scout geographic targeting blend strengths (ADR 0022) ───────────────────

/**
 * Blend strength (α_comp) folding the structural metro-density competition
 * proxy into winnability. Calibrated on and shipped at 0.25 (ADR 0022): the
 * geo-tier report was observed and the blend is now live rather than inert.
 * Operator-overridable via system_state.scout_geo_comp_blend — that value
 * still wins over this default.
 */
export const DEFAULT_GEO_COMP_BLEND = 0.25;

/**
 * Blend strength (α_dem) folding Census-derived demand quality into estimated
 * monthly value. Calibrated on and shipped at 0.25 (ADR 0022): the geo-tier
 * report was observed and the blend is now live rather than inert.
 * Operator-overridable via system_state.scout_geo_demand_blend — that value
 * still wins over this default.
 */
export const DEFAULT_GEO_DEMAND_BLEND = 0.25;

// ── Scout Stage-3 local-SERP refinement budget (ADR 0022 §5) ────────────────

/**
 * In-run DataForSEO budget cap (USD) for the bounded local-SERP refinement
 * pass. Raised $3 → $5 (ADR 0030): ~66 cold SERP calls at $0.075, far more on
 * a warm cache — enough to cover the top-50 + sampling + the ensure-measured
 * pass on a cold day. The per-agent and global caps only fire at run start, so
 * this in-run guard is the real bound on refinement spend. Operator-overridable
 * per-run (ScoutForm) or globally via system_state.scout_refine_budget_usd.
 */
export const DEFAULT_SCOUT_REFINE_BUDGET_USD = 5.00;

/**
 * Number of top-scoring cells fed to the local-SERP refinement pass. ON by
 * default; raised 25 → 50 (ADR 0030) so more of the final ranking rests on
 * measured local SERPs rather than the national-kd proxy. Budget-capped by
 * DEFAULT_SCOUT_REFINE_BUDGET_USD. Set to 0 per-run via ScoutForm or globally
 * via system_state.scout_refine_top_k to disable.
 */
export const DEFAULT_SCOUT_REFINE_TOP_K = 50;

/**
 * Max passes of the ensure-measured-above-the-cliff loop (ADR 0030): after the
 * refinement re-sort, any still-proxy cell ranked inside the value-cliff
 * recommendation is refined and the ranking recomputed, up to this many
 * iterations. A budget trip mid-loop only flags
 * report.refinement.recommendation_fully_measured=false — it never shrinks
 * recommendation.n, which must not depend on live spend or cache warmth.
 */
export const ENSURE_MEASURED_MAX_ITERATIONS = 3;

/**
 * Below-top-K sampling (Phase 5, Niche Algorithm Accuracy plan). The top-K
 * refinement loop above only ever measures the highest-ranked proxy cells, so
 * a low-competition cell buried just outside the cut (e.g. rank 60) never gets
 * a real local-SERP measurement and can never surface. After the top-K loop
 * completes, if refine budget remains, up to this many additional cells are
 * sampled uniformly at random from the next tier down — ranks
 * [refine_top_k, refine_top_k * BELOW_TOPK_TIER_MULTIPLIER) — and refined
 * using the same budget-checked path as the top-K loop.
 */
export const DEFAULT_SCOUT_BELOW_TOPK_SAMPLE_COUNT = 10;

/**
 * Width (in multiples of refine_top_k) of the "next tier down" sampled by
 * the below-top-K pass. 4x keeps the sample scoped to cells that are still
 * plausibly competitive (not the whole long tail of the grid).
 */
export const BELOW_TOPK_TIER_MULTIPLIER = 4;

// ── State-level demand fold (ADR 0030 S2 / Phase 5) ─────────────────────────

/**
 * Max stateFit deviation from 1.0 in either direction: the per-(trade, state)
 * volume-share / population-share ratio is clamped to [1/clamp, clamp] before
 * it is blended into estMonthlyValueUsd. Keeps a single noisy Google Ads state
 * reading from swinging a cell's value by more than 4x even at blend 1.0.
 * Operator-overridable via system_state.scout_state_demand_clamp.
 */
export const DEFAULT_STATE_DEMAND_CLAMP = 4.0;

/**
 * In-run DataForSEO sub-budget (USD) for the state-demand pass. Worst-case
 * cold cost is survivingTrades × runStates × $0.0012 (getStateKeywordMetrics);
 * when that projection exceeds this cap the whole pass is skipped and the
 * report says so (skipped_reason 'over_sub_budget') — the pass never partially
 * folds some trades and not others on cost grounds alone. Cache hits are $0,
 * so warm reruns effectively never trip the actual-spend guard.
 */
export const STATE_DEMAND_SUB_BUDGET_USD = 2.0;

// ── Approval-time diversity warning (Phase 5, Niche Algorithm Accuracy plan) ─

/**
 * Same-trade concentration threshold for the operator approve-flow warning
 * (apps/operator/app/operator/niches/actions.ts). When the trade being
 * approved already has this many (or more) approved niches, a non-blocking
 * warning surfaces before the decision is finalized. Not operator-overridable
 * (a small, easy-to-reason-about constant) — only the per-state share below
 * has a system_state override, matching what the plan asked for.
 */
export const APPROVE_SAME_TRADE_WARNING_COUNT = 3;

/**
 * Max fraction of the APPROVED set any single state may occupy before the
 * approve-flow warning surfaces (non-blocking — approval still proceeds).
 * Operator-overridable via system_state.approve_max_per_state_share.
 */
export const DEFAULT_APPROVE_MAX_PER_STATE_SHARE = 0.40;

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

/**
 * Max fraction of the persisted set any single population band (<25k, 25-50k,
 * 50-100k, 100k+) may occupy (F4). est value is monotonic in population, so
 * without this the 100k+ band takes almost the whole set (98% of top-100 value
 * in run 5d1ec782) and only a handful of large cities ever surface. 0.40 lets
 * the strongest band keep a plurality while freeing ~60% of slots for smaller
 * cities, which fill by score-desc. Resolved to an absolute per-band count
 * against persist_top at selection time. Operator-overridable via
 * system_state.scout_max_pop_band_share; NULL = this default. Set to >=1.0 to
 * disable (any single band may fill the whole set).
 */
export const SCOUT_MAX_POP_BAND_SHARE = 0.40;

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

/**
 * Scout-only demand resolution for a Stage-3 refined cell that has a measured
 * local volume AND a population-scaled proxy (F3).
 *
 * - Measured clears the trust floor → trust it.
 * - Measured is present but below the floor → we don't trust the exact sub-100
 *   number (DFS buckets hyperlocal queries to ~10), but a sub-floor reading is
 *   still evidence the market is small, so the inflated proxy must NOT be kept.
 *   Clamp the proxy down to the floor. This is what stops the ~10x scout-value
 *   inflation seen in run 5d1ec782 (e.g. Logan personal-injury proxy $10.3k vs
 *   real ~$925).
 *
 * Deliberately scout-local: the shared `resolveDemandVolume` (used by the
 * validate path + operator UI) keeps its "measured-or-proxy" contract. Only the
 * scout, which has both a concrete proxy and a fresh measurement in hand, applies
 * the clamp.
 */
export function resolveRefinedCityVolume(measuredVolume: number, proxyVolume: number): number {
  if (measuredVolume >= DFS_TRUST_FLOOR) return measuredVolume;
  return Math.min(proxyVolume, DFS_TRUST_FLOOR);
}

// ── Seasonality dampening (Phase 5, Niche Algorithm Accuracy plan) ──────────

/**
 * Below this trough/peak ratio, a trade is considered "highly seasonal"
 * (e.g. snow removal: trough near 0 in July, peak in January). A value near
 * 1.0 means flat demand year-round. Below the threshold, validate.ts dampens
 * the measured current-month-driven volume toward the trade's annual mean
 * before it is fed into the dollar-value model, so a niche validated during
 * its peak month isn't overvalued relative to its true annual average.
 */
export const SEASONALITY_DAMPENING_THRESHOLD = 0.35;

/** Seasonality signal derived from a trailing ~12mo monthly-volume series. */
export interface SeasonalitySignal {
  /** trough/peak on a 0-1 scale; null when no monthly history exists. */
  seasonalityIndex: number | null;
  /** Mean of the monthly series; null when no monthly history exists. */
  annualMean: number | null;
  /** True when seasonalityIndex < SEASONALITY_DAMPENING_THRESHOLD. */
  isHighlySeasonal: boolean;
}

/**
 * Single source of truth for the seasonality math shared by validateNicheCore
 * and the scout's Stage-3 measured-volume path (ADR 0030 M1). Near-1 index =
 * flat demand year-round; near-0 = highly seasonal (e.g. snow removal). Null
 * index/mean when the series is empty — callers never dampen in that case.
 */
export function computeSeasonalitySignal(monthlyValues: number[]): SeasonalitySignal {
  if (monthlyValues.length === 0) {
    return { seasonalityIndex: null, annualMean: null, isHighlySeasonal: false };
  }
  const peak = Math.max(...monthlyValues);
  const trough = Math.min(...monthlyValues);
  const seasonalityIndex = peak > 0 ? trough / peak : null;
  const annualMean = monthlyValues.reduce((s, v) => s + v, 0) / monthlyValues.length;
  return {
    seasonalityIndex,
    annualMean,
    isHighlySeasonal:
      seasonalityIndex !== null && seasonalityIndex < SEASONALITY_DAMPENING_THRESHOLD,
  };
}

/**
 * Dampen a current-month-driven measured volume toward the annual mean for a
 * highly seasonal trade — a niche measured during its peak month must not be
 * valued off peak demand. No-op (returns rawVolume) unless the signal is
 * highly seasonal with a usable annual mean.
 */
export function dampenSeasonalVolume(rawVolume: number, signal: SeasonalitySignal): number {
  return signal.isHighlySeasonal && signal.annualMean !== null
    ? (rawVolume + signal.annualMean) / 2
    : rawVolume;
}

// ── Approval-time diversity warning: pure trigger logic ─────────────────────

export interface ApprovalDiversityInput {
  /** Trade + state of the niche about to be approved. */
  trade: string;
  state: string;
  /** trade/state of every currently-approved niche (decision='approved'). */
  approvedRows: Array<{ trade: string; state: string }>;
  /** NULL/undefined = code default (DEFAULT_APPROVE_MAX_PER_STATE_SHARE). */
  maxPerStateShare?: number | null;
}

export interface ApprovalDiversityResult {
  shouldWarn: boolean;
  sameTradeApprovedCount: number;
  sameStateApprovedCount: number;
  totalApprovedCount: number;
  /** Share the approved set's target state WOULD have after this approval. */
  sameStateShare: number;
  maxPerStateShare: number;
  tradeTriggered: boolean;
  stateTriggered: boolean;
}

/**
 * Minimum prior-approved-count before the per-state share trigger is even
 * evaluated. Without this floor, the very first approval in an empty (or
 * near-empty) portfolio is mechanically "100% of one state" and would warn
 * every single time — noise, not signal. Chosen to match
 * APPROVE_SAME_TRADE_WARNING_COUNT (3): a portfolio needs at least a handful
 * of approved niches before "concentration" is a meaningful concept.
 */
const APPROVE_STATE_SHARE_MIN_SAMPLE = APPROVE_SAME_TRADE_WARNING_COUNT;

/**
 * Pure trigger-condition evaluation for the operator approve-flow's
 * non-blocking diversity warning (apps/operator/app/operator/niches/actions.ts
 * getNicheApprovalWarning). Extracted here (not inlined in the operator app,
 * which has no test runner) so the logic is unit-testable under vitest.
 *
 * Two independent triggers, either sets shouldWarn — approval is NEVER
 * blocked by this, callers only use it to inform confirm-dialog copy:
 *   - the trade already has >= APPROVE_SAME_TRADE_WARNING_COUNT (3) approved
 *     niches.
 *   - approving this niche's state would make that state's share of the
 *     approved set exceed maxPerStateShare (default 0.40) — only evaluated
 *     once at least APPROVE_STATE_SHARE_MIN_SAMPLE niches are already
 *     approved (see constant doc above).
 */
export function evaluateApprovalDiversity(input: ApprovalDiversityInput): ApprovalDiversityResult {
  const maxPerStateShare = input.maxPerStateShare ?? DEFAULT_APPROVE_MAX_PER_STATE_SHARE;
  const trade = input.trade.toLowerCase();
  const state = input.state.toUpperCase();

  const totalApprovedCount = input.approvedRows.length;
  const sameTradeApprovedCount = input.approvedRows.filter(
    (r) => r.trade.toLowerCase() === trade,
  ).length;
  const sameStateApprovedCount = input.approvedRows.filter(
    (r) => r.state.toUpperCase() === state,
  ).length;

  // Share this approval WOULD produce (numerator/denominator both +1) — the
  // check is forward-looking ("would approving this push us over the line?"),
  // not just a snapshot of the set before this decision.
  const sameStateShare = (sameStateApprovedCount + 1) / (totalApprovedCount + 1);

  const tradeTriggered = sameTradeApprovedCount >= APPROVE_SAME_TRADE_WARNING_COUNT;
  const stateTriggered =
    totalApprovedCount >= APPROVE_STATE_SHARE_MIN_SAMPLE && sameStateShare > maxPerStateShare;

  return {
    shouldWarn: tradeTriggered || stateTriggered,
    sameTradeApprovedCount,
    sameStateApprovedCount,
    totalApprovedCount,
    sameStateShare,
    maxPerStateShare,
    tradeTriggered,
    stateTriggered,
  };
}
