import { z } from 'zod';
import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import {
  getDb,
  sites,
  nicheOutcomeSnapshots,
  calibrationSuggestions,
  getSystemState,
} from '@leadlandlord/db';
import { BaseAgent, type AgentContext } from '../base';
import { DEFAULT_CTR_AT_RANK, DEFAULT_CALL_RATE } from '../niche-hunter/value-model';
import { buildSuggestions, type OutcomeRow, type SuggestionDraft } from './compute';

/**
 * Niche Prior Suggester — Phase 2 of the Niche Algorithm Accuracy plan.
 *
 * Pure computation over the last N weeks of niche_outcome_snapshots, pooled
 * by trade (via lead-benchmarks.ts's canonical-trade resolver) and by
 * trade+state, computing shrinkage-adjusted suggestions for the scout's
 * static priors (scout_ctr_at_rank, scout_call_rate).
 *
 * Only scope='global' suggestions are ever surfaced with an "Apply" action —
 * enforced server-side in the operator action regardless of what the client
 * sends. scope='trade'|'trade_state' suggestions are informational, meant to
 * guide manual hand-tuning of TRADE_BENCHMARKS entries in lead-benchmarks.ts.
 *
 * No LLM calls — deterministic aggregation + shrinkage math only.
 */

export const NichePriorSuggesterInput = z.object({
  /** How many trailing weeks of niche_outcome_snapshots to pool. */
  lookback_weeks: z.number().int().positive().max(52).default(8),
});
export type NichePriorSuggesterInput = z.infer<typeof NichePriorSuggesterInput>;

export const NichePriorSuggesterOutput = z.object({
  weeks_considered: z.number().int().nonnegative(),
  snapshots_considered: z.number().int().nonnegative(),
  suggestions_written: z.number().int().nonnegative(),
  superseded: z.number().int().nonnegative(),
});
export type NichePriorSuggesterOutput = z.infer<typeof NichePriorSuggesterOutput>;

/** ISO week key ("this Monday's date") anchors the dedupe key so re-firing within the same week is a queue-level no-op. */
export function currentIsoWeekMonday(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (dayNum - 1));
  return date.toISOString().slice(0, 10);
}

function weeksAgoDate(weeks: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - weeks * 7);
  return d.toISOString().slice(0, 10);
}

export class NichePriorSuggester extends BaseAgent<
  typeof NichePriorSuggesterInput,
  typeof NichePriorSuggesterOutput
> {
  constructor() {
    super({
      name: 'niche-prior-suggester',
      inputSchema: NichePriorSuggesterInput,
      outputSchema: NichePriorSuggesterOutput,
      defaultDailyCapUsd: 1,
      dedupeKeyFn: () => `niche-prior-suggester:${currentIsoWeekMonday()}`,
    });
  }

  protected async execute(
    input: NichePriorSuggesterInput,
    ctx: AgentContext,
  ): Promise<NichePriorSuggesterOutput> {
    const db = getDb();
    const cutoff = weeksAgoDate(input.lookback_weeks);

    const snapshotRows = await db
      .select()
      .from(nicheOutcomeSnapshots)
      .where(gte(nicheOutcomeSnapshots.weekStart, cutoff));

    ctx.log.info(
      { lookbackWeeks: input.lookback_weeks, cutoff, count: snapshotRows.length },
      'niche-prior-suggester: snapshots loaded',
    );

    if (snapshotRows.length === 0) {
      return {
        weeks_considered: input.lookback_weeks,
        snapshots_considered: 0,
        suggestions_written: 0,
        superseded: 0,
      };
    }

    // Resolve site niche/state for every distinct site referenced.
    const siteIds = [...new Set(snapshotRows.map((r) => r.siteId))];
    const siteRows = await db
      .select({ id: sites.id, niche: sites.niche, state: sites.state })
      .from(sites)
      .where(inArray(sites.id, siteIds));
    const siteById = new Map(siteRows.map((s) => [s.id, s]));

    const rows: OutcomeRow[] = [];
    for (const snap of snapshotRows) {
      const site = siteById.get(snap.siteId);
      if (!site) continue; // orphaned snapshot (site deleted) — skip, don't crash the run
      const moneyKwClicks = snap.moneyKwClicks;
      const observedCallRate = snap.observedCallRate !== null ? parseFloat(snap.observedCallRate) : null;
      // Reconstruct calls-in-week from observedCallRate * moneyKwClicks (the
      // agent never persisted a raw calls column — see nicheOutcomeSnapshots
      // schema comment: "does NOT add calls/leads/tenant/mrr columns").
      const callsInWeek = observedCallRate !== null ? Math.round(observedCallRate * moneyKwClicks) : 0;
      rows.push({
        niche: site.niche,
        state: site.state,
        moneyKwImpressions: snap.moneyKwImpressions,
        moneyKwClicks,
        callsInWeek,
      });
    }

    const sys = await getSystemState();
    const currentGlobalCtrPrior = sys.scoutCtrAtRank != null ? parseFloat(sys.scoutCtrAtRank) : DEFAULT_CTR_AT_RANK;
    const currentGlobalCallRatePrior =
      sys.scoutCallRate != null ? parseFloat(sys.scoutCallRate) : DEFAULT_CALL_RATE;

    const drafts = buildSuggestions({ rows, currentGlobalCtrPrior, currentGlobalCallRatePrior });

    ctx.progress({ label: `writing ${drafts.length} calibration suggestions` });

    let superseded = 0;
    let written = 0;
    for (const draft of drafts) {
      superseded += await supersedeOpenSuggestions(draft);
      await insertSuggestion(draft);
      written += 1;
    }

    return {
      weeks_considered: input.lookback_weeks,
      snapshots_considered: snapshotRows.length,
      suggestions_written: written,
      superseded,
    };
  }
}

/**
 * Mark any existing OPEN suggestion for the same (scope, trade, state, knob)
 * tuple as 'superseded' before inserting the fresh one — the partial unique
 * index only allows one open row per tuple, so this must run first.
 */
async function supersedeOpenSuggestions(draft: SuggestionDraft): Promise<number> {
  const db = getDb();
  // NULL-safe equality for trade/state: drizzle's eq() produces `col = NULL`
  // (never true in SQL) when the draft's value is null (global scope), so use
  // isNull() explicitly in that case instead.
  const conditions = [
    eq(calibrationSuggestions.scope, draft.scope),
    eq(calibrationSuggestions.knob, draft.knob),
    eq(calibrationSuggestions.status, 'open'),
    draft.trade === null ? isNull(calibrationSuggestions.trade) : eq(calibrationSuggestions.trade, draft.trade),
    draft.state === null ? isNull(calibrationSuggestions.state) : eq(calibrationSuggestions.state, draft.state),
  ];

  const existing = await db
    .select({ id: calibrationSuggestions.id })
    .from(calibrationSuggestions)
    .where(and(...conditions));

  if (existing.length === 0) return 0;

  await db
    .update(calibrationSuggestions)
    .set({ status: 'superseded' })
    .where(
      inArray(
        calibrationSuggestions.id,
        existing.map((e) => e.id),
      ),
    );
  return existing.length;
}

async function insertSuggestion(draft: SuggestionDraft): Promise<void> {
  const db = getDb();
  await db.insert(calibrationSuggestions).values({
    scope: draft.scope,
    trade: draft.trade,
    state: draft.state,
    knob: draft.knob,
    suggestedValue: draft.suggestedValue.toFixed(4),
    sampleSize: draft.sampleSize,
    evidence: draft.evidence,
    status: 'open',
  });
}
