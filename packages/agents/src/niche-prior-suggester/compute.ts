import { resolveCanonicalTrade } from '../niche-hunter/lead-benchmarks';

/**
 * Pure computation for the niche-prior-suggester agent (Phase 2, calibration
 * feedback loop). Pools niche_outcome_snapshots (sum of clicks/calls, NOT an
 * average of per-row ratios — a 1-click week and a 1000-click week must not
 * count equally) grouped by trade and by trade+state, then applies a
 * shrinkage estimate toward the current global prior.
 *
 * Shrinkage formula (both knobs): (n/(n+K)) * observed + (K/(n+K)) * currentPrior
 * K = 5, a soft "prior sample size" — with n=5 observed and prior get equal
 * weight; as n grows the suggestion converges on the observed pooled rate.
 */

export const SHRINKAGE_K = 5;

/** Minimum pooled sample size (money-keyword-click count) for a trade-scope suggestion. */
export const MIN_TRADE_SAMPLE = 5;

/** Minimum pooled sample size for a trade+state-scope suggestion (finer grain, needs less to be useful but must still be non-trivial). */
export const MIN_TRADE_STATE_SAMPLE = 3;

export interface OutcomeRow {
  niche: string;
  state: string;
  moneyKwImpressions: number;
  moneyKwClicks: number;
  /** Calls attributed to this site+week (already computed as observedCallRate's numerator upstream). */
  callsInWeek: number;
}

export interface PooledGroup {
  scope: 'trade' | 'trade_state';
  trade: string;
  state: string | null;
  /** Sample size — pooled money-keyword clicks (the denominator for both CTR and call-rate suggestions). */
  sampleSize: number;
  pooledImpressions: number;
  pooledClicks: number;
  pooledCalls: number;
  observedCtr: number | null;
  observedCallRate: number | null;
}

/**
 * Shrinkage-adjusted suggestion: (n/(n+K)) * observed + (K/(n+K)) * currentPrior.
 */
export function shrinkageSuggest(observed: number, currentPrior: number, n: number, k = SHRINKAGE_K): number {
  if (n <= 0) return currentPrior;
  const weight = n / (n + k);
  return weight * observed + (1 - weight) * currentPrior;
}

/**
 * Pool outcome rows by canonical trade (resolveCanonicalTrade) and by
 * trade+state. Rows whose niche doesn't resolve to a mapped TRADE_BENCHMARKS
 * entry are excluded — there's no trade label to group them under.
 */
export function poolByTradeAndState(rows: OutcomeRow[]): PooledGroup[] {
  const byTrade = new Map<string, { impressions: number; clicks: number; calls: number }>();
  const byTradeState = new Map<string, { trade: string; state: string; impressions: number; clicks: number; calls: number }>();

  for (const row of rows) {
    const trade = resolveCanonicalTrade(row.niche);
    if (!trade) continue;

    const t = byTrade.get(trade) ?? { impressions: 0, clicks: 0, calls: 0 };
    t.impressions += row.moneyKwImpressions;
    t.clicks += row.moneyKwClicks;
    t.calls += row.callsInWeek;
    byTrade.set(trade, t);

    const tsKey = `${trade}::${row.state}`;
    const ts = byTradeState.get(tsKey) ?? { trade, state: row.state, impressions: 0, clicks: 0, calls: 0 };
    ts.impressions += row.moneyKwImpressions;
    ts.clicks += row.moneyKwClicks;
    ts.calls += row.callsInWeek;
    byTradeState.set(tsKey, ts);
  }

  const groups: PooledGroup[] = [];
  for (const [trade, agg] of byTrade.entries()) {
    groups.push({
      scope: 'trade',
      trade,
      state: null,
      sampleSize: agg.clicks,
      pooledImpressions: agg.impressions,
      pooledClicks: agg.clicks,
      pooledCalls: agg.calls,
      observedCtr: agg.impressions > 0 ? agg.clicks / agg.impressions : null,
      observedCallRate: agg.clicks > 0 ? agg.calls / agg.clicks : null,
    });
  }
  for (const { trade, state, ...agg } of byTradeState.values()) {
    groups.push({
      scope: 'trade_state',
      trade,
      state,
      sampleSize: agg.clicks,
      pooledImpressions: agg.impressions,
      pooledClicks: agg.clicks,
      pooledCalls: agg.calls,
      observedCtr: agg.impressions > 0 ? agg.clicks / agg.impressions : null,
      observedCallRate: agg.clicks > 0 ? agg.calls / agg.clicks : null,
    });
  }
  return groups;
}

export interface SuggestionDraft {
  scope: 'global' | 'trade' | 'trade_state';
  trade: string | null;
  state: string | null;
  knob: 'scout_ctr_at_rank' | 'scout_call_rate';
  suggestedValue: number;
  sampleSize: number;
  evidence: Record<string, unknown>;
}

export interface BuildSuggestionsArgs {
  rows: OutcomeRow[];
  currentGlobalCtrPrior: number;
  currentGlobalCallRatePrior: number;
}

/**
 * Build the full suggestion set: for every trade group meeting MIN_TRADE_SAMPLE,
 * always compute + emit trade-scope suggestions (informational — they guide
 * hand-tuning TRADE_BENCHMARKS, never applied to a global knob). For every
 * trade+state group meeting MIN_TRADE_STATE_SAMPLE, same. A single GLOBAL
 * suggestion per knob is derived by pooling ALL money-keyword rows (regardless
 * of trade match) — this is the only source of a global-scope suggestion, and
 * it is the only scope the operator UI may apply directly.
 */
export function buildSuggestions(args: BuildSuggestionsArgs): SuggestionDraft[] {
  const { rows, currentGlobalCtrPrior, currentGlobalCallRatePrior } = args;
  const drafts: SuggestionDraft[] = [];

  // ── Global pool: every row with usable money-keyword data, trade-agnostic ──
  let globalImpressions = 0;
  let globalClicks = 0;
  let globalCalls = 0;
  for (const row of rows) {
    globalImpressions += row.moneyKwImpressions;
    globalClicks += row.moneyKwClicks;
    globalCalls += row.callsInWeek;
  }

  if (globalImpressions > 0) {
    const observedCtr = globalClicks / globalImpressions;
    const n = globalClicks; // sample size = pooled money-keyword clicks (CTR's own denominator's numerator)
    const suggested = shrinkageSuggest(observedCtr, currentGlobalCtrPrior, n);
    drafts.push({
      scope: 'global',
      trade: null,
      state: null,
      knob: 'scout_ctr_at_rank',
      suggestedValue: round4(suggested),
      sampleSize: n,
      evidence: {
        observed: round4(observedCtr),
        currentPrior: currentGlobalCtrPrior,
        pooledImpressions: globalImpressions,
        pooledClicks: globalClicks,
        shrinkageK: SHRINKAGE_K,
      },
    });
  }

  if (globalClicks > 0) {
    const observedCallRate = globalCalls / globalClicks;
    const n = globalClicks;
    const suggested = shrinkageSuggest(observedCallRate, currentGlobalCallRatePrior, n);
    drafts.push({
      scope: 'global',
      trade: null,
      state: null,
      knob: 'scout_call_rate',
      suggestedValue: round4(suggested),
      sampleSize: n,
      evidence: {
        observed: round4(observedCallRate),
        currentPrior: currentGlobalCallRatePrior,
        pooledClicks: globalClicks,
        pooledCalls: globalCalls,
        shrinkageK: SHRINKAGE_K,
      },
    });
  }

  // ── Trade / trade+state pools: always computed, informational only ──
  const pooled = poolByTradeAndState(rows);
  for (const group of pooled) {
    const minSample = group.scope === 'trade' ? MIN_TRADE_SAMPLE : MIN_TRADE_STATE_SAMPLE;
    if (group.sampleSize < minSample) continue;

    if (group.observedCtr !== null) {
      const suggested = shrinkageSuggest(group.observedCtr, currentGlobalCtrPrior, group.sampleSize);
      drafts.push({
        scope: group.scope,
        trade: group.trade,
        state: group.state,
        knob: 'scout_ctr_at_rank',
        suggestedValue: round4(suggested),
        sampleSize: group.sampleSize,
        evidence: {
          observed: round4(group.observedCtr),
          currentPrior: currentGlobalCtrPrior,
          pooledImpressions: group.pooledImpressions,
          pooledClicks: group.pooledClicks,
          shrinkageK: SHRINKAGE_K,
        },
      });
    }

    if (group.observedCallRate !== null) {
      const suggested = shrinkageSuggest(group.observedCallRate, currentGlobalCallRatePrior, group.sampleSize);
      drafts.push({
        scope: group.scope,
        trade: group.trade,
        state: group.state,
        knob: 'scout_call_rate',
        suggestedValue: round4(suggested),
        sampleSize: group.sampleSize,
        evidence: {
          observed: round4(group.observedCallRate),
          currentPrior: currentGlobalCallRatePrior,
          pooledClicks: group.pooledClicks,
          pooledCalls: group.pooledCalls,
          shrinkageK: SHRINKAGE_K,
        },
      });
    }
  }

  return drafts;
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}
