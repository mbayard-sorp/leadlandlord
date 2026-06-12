import { DEFAULT_WEIGHTS, type ScoringWeights } from './scoring-config';
export {
  DEFAULT_WEIGHTS,
  DFS_TRUST_FLOOR,
  DEMAND_SUB_SATURATION_CEILING,
  resolveDemandVolume,
} from './scoring-config';

/**
 * Niche scoring shared pieces.
 *
 * The legacy LLM-brainstorm NicheHunter agent was removed 2026-06-12 (ADR
 * 0020) in favor of the deterministic scout/validate engine:
 *   - scout.ts      — niche-scout agent (grid enumeration, cached scoring)
 *   - validator.ts  — niche-validator agent (paid DFS validation + promote)
 *   - refresher.ts  — quarterly keyword-cluster cache warm
 *   - value-model.ts — dollar-denominated expected-value formulas
 *   - validate.ts   — validateNicheCore shared by the agent + server action
 *
 * computeScore stays while the legacy 0-100 `score` column is still written
 * and displayed alongside validated_monthly_value_usd (one release of
 * overlap, per the cutover plan).
 */

interface ScoreInputs {
  search_volume: number;
  kd: number;
  competition: number;
  est_avg_job_value_usd: number;
  est_close_rate: number;
  ad_count: number;
  weights: ScoringWeights;
  /**
   * ADR 0009 Phase 1 / A2. Average CPC from DataForSEO keyword metrics.
   * When present: sub-score = Math.min(1, avg_cpc / 15), weight 0.05.
   * When absent (undefined): the CPC term is OMITTED ENTIRELY — the five
   * legacy weights operate exactly as before and existing scores are
   * unchanged. Do not pass 0 to silence — omit the field.
   */
  avg_cpc?: number;
  /**
   * ADR 0009 Phase 1 / A3. Rentability prior from getRentabilityPrior().
   * Range 0..1; 0.5 is neutral (unknown trade). Weight 0.05.
   * When absent (undefined): the rentability term is OMITTED ENTIRELY —
   * legacy weights are unchanged.
   */
  rentability_prior?: number;
}

/**
 * Composite legacy score using configurable weights.
 *
 * Dimension sub-scores (all 0..1 before weighting):
 *   demand           — log-scaled search volume
 *   serp_difficulty  — KD-inverse x competition-inverse
 *   ad_presence      — ad_count / 10 (capped)
 *   city_size_fit    — job value relative to $500 benchmark
 *   niche_risk       — close rate (higher = lower risk)
 *
 * Optional additive sub-scores (ADR 0009 Phase 1):
 *   avg_cpc          — Math.min(1, avg_cpc / 15), weight 0.05
 *   rentability_prior — 0..1 trade benchmark prior, weight 0.05
 *
 * Raw sum is scaled by 100 so a "great" niche scores near 100.
 */
export function computeScore(s: ScoreInputs): number {
  const weights = s.weights ?? DEFAULT_WEIGHTS;

  // Saturates at 1.0 when search_volume >= DEMAND_SUB_SATURATION_CEILING (10,000).
  const demandSub = Math.min(1, Math.log10(Math.max(1, s.search_volume + 1)) / 4); // log10(10000)=4 -> 1.0
  const kdInverse = (100 - Math.max(0, Math.min(100, s.kd))) / 100;
  const compInverse = 1 - Math.max(0, Math.min(1, s.competition));
  const serpSub = kdInverse * compInverse;
  const adSub = Math.min(1, s.ad_count / 10);
  const valueSub = Math.min(1, Math.max(0, s.est_avg_job_value_usd) / 500);
  const closeSub = Math.max(0.01, Math.min(1, s.est_close_rate));

  let raw =
    weights.demand * demandSub +
    weights.serp_difficulty * serpSub +
    weights.ad_presence * adSub +
    weights.city_size_fit * valueSub +
    weights.niche_risk * closeSub;

  if (s.avg_cpc !== undefined) {
    const cpcSub = Math.min(1, s.avg_cpc / 15);
    raw += 0.05 * cpcSub;
  }

  if (s.rentability_prior !== undefined) {
    const rentSub = Math.max(0, Math.min(1, s.rentability_prior));
    raw += 0.05 * rentSub;
  }

  return Number((raw * 100).toFixed(2));
}
