import { randomUUID } from 'node:crypto';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, agentRuns, agentBudgets, agentEvents, systemState, getSystemState } from '@leadlandlord/db';
import {
  AgentDisabledError,
  AgentRunError,
  BudgetExceededError,
  GlobalBudgetExceededError,
  KillSwitchActiveError,
} from '@leadlandlord/shared/errors';
import { log as rootLog, type Logger } from '@leadlandlord/shared/log';

/**
 * Portfolio-wide daily spend gate (orchestrator Phase 2). A cap of <= 0 means
 * "no global limit" (so setting the cap to 0 disables the ceiling rather than
 * bricking the whole fleet). Otherwise the fleet pauses once cumulative spend
 * for the UTC day reaches the cap.
 */
export function isOverGlobalBudget(spentTodayUsd: number, capUsd: number): boolean {
  if (capUsd <= 0) return false;
  return spentTodayUsd >= capUsd;
}

/**
 * Per-agent monthly spend gate (orchestrator Phase 2). Same <= 0 == unlimited
 * convention as the global cap.
 */
export function isOverMonthlyBudget(spentMonthUsd: number, capUsd: number): boolean {
  if (capUsd <= 0) return false;
  return spentMonthUsd >= capUsd;
}

export interface AgentContext {
  runId: string;
  log: Logger;
  /**
   * Set when the agent is invoked as a sub-agent of another agent (e.g.
   * site-builder calling keyword-planner). Sub-agents should suppress emits
   * of "next-step" events that the parent already orchestrates in-process —
   * e.g. keyword-planner emits `cluster.ready → site-builder` only when it
   * runs standalone (operator UI re-target button); inside site-builder the
   * orchestrator chains the next step directly.
   */
  parentRunId: string | null;
  /** Subclasses call this whenever they make an LLM call so cost tracking flows up. */
  recordUsage(args: {
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    cost_usd: number;
  }): void;
  /**
   * Emit a progress update visible in the operator activity panel. Throttled
   * to ~once/sec — calls inside the throttle window are coalesced (the latest
   * label wins). Pass `step`/`total` to render a progress bar; pass just
   * `label` for a free-text status. Cleared automatically when the run ends.
   */
  progress(args: { step?: number; total?: number; label: string }): void;
  /**
   * Insert a "next step" event into the agent_events queue, intended for the
   * cron dispatcher to pick up and route to `targetAgent`. Automatically
   * SUPPRESSED when this agent is running as a sub-agent (parentRunId set) —
   * the parent orchestrator is already chaining the next step in-process; a
   * second cron-driven invocation would spawn a duplicate pipeline.
   *
   * Use this helper instead of raw `db.insert(agentEvents)` for any emit that
   * represents "the next step in the pipeline." Reserve raw inserts for
   * legitimate fan-outs (one event per child entity) where the suppression
   * semantics would be wrong — see churn-recovery's outreach.kick emits.
   *
   * Hit a 79-event cluster.ready cascade on 2026-05-07 from forgetting this
   * guard in keyword-planner. Never again.
   */
  emitNextStepEvent(args: {
    type: string;
    targetAgent: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

export interface AgentRunOptions {
  /**
   * Explicit dedupe key. When set, takes precedence over the agent's own
   * `dedupeKeyFn`. Reserved for callers that must override the agent's
   * natural idempotency (rare). Most callers should leave this undefined
   * and let the agent's `dedupeKeyFn` win.
   */
  dedupeKey?: string;
  parentRunId?: string;
  siteId?: string;
  /**
   * The agent_events row id this run was dispatched from, when applicable.
   * Used as a last-resort dedupeKey fallback when the agent has no
   * `dedupeKeyFn`. PRIOR BUG: the dispatcher used to pass this as the
   * primary `dedupeKey`, which OVERRODE every agent's `dedupeKeyFn`. With
   * 79 cluster.ready events stacked in the queue, the override produced
   * 79 unique dedupe keys, defeating BaseAgent's findExistingSuccess
   * short-circuit and causing 154 content-engine runs to spawn.
   * See incident 2026-05-07.
   */
  eventId?: string;
}

export interface BaseAgentConfig<I extends z.ZodTypeAny, O extends z.ZodTypeAny> {
  name: string;
  inputSchema: I;
  outputSchema: O;
  /** Compute a dedupe key from input when caller doesn't supply one. */
  dedupeKeyFn?: (input: z.infer<I>) => string | undefined;
  /** Default daily cost cap used when no row exists in agent_budgets. */
  defaultDailyCapUsd?: number;
}

export abstract class BaseAgent<I extends z.ZodTypeAny, O extends z.ZodTypeAny> {
  readonly name: string;
  readonly inputSchema: I;
  readonly outputSchema: O;
  protected readonly dedupeKeyFn?: (input: z.infer<I>) => string | undefined;
  protected readonly defaultDailyCapUsd: number;

  constructor(cfg: BaseAgentConfig<I, O>) {
    this.name = cfg.name;
    this.inputSchema = cfg.inputSchema;
    this.outputSchema = cfg.outputSchema;
    this.dedupeKeyFn = cfg.dedupeKeyFn;
    this.defaultDailyCapUsd = cfg.defaultDailyCapUsd ?? 5;
  }

  /**
   * Subclasses implement the actual work. The base class handles persistence,
   * dedup, budget checks, and error capture.
   */
  protected abstract execute(input: z.infer<I>, ctx: AgentContext): Promise<z.infer<O>>;

  async run(rawInput: unknown, opts: AgentRunOptions = {}): Promise<z.infer<O>> {
    const input = this.inputSchema.parse(rawInput);
    // Precedence: explicit override > agent's natural keyFn > event-id fallback.
    // The agent's `dedupeKeyFn` MUST win over `eventId` so duplicate events for
    // the same logical work (e.g. 79 cluster.ready events for one site) collapse
    // to a single cached run via findExistingSuccess. See incident 2026-05-07.
    const dedupeKey =
      opts.dedupeKey
      ?? this.dedupeKeyFn?.(input)
      ?? (opts.eventId ? `event:${opts.eventId}` : undefined);

    // Idempotent short-circuit: if we already succeeded for this dedupe key, return that output.
    if (dedupeKey) {
      const existing = await this.findExistingSuccess(dedupeKey);
      if (existing) {
        rootLog.info({ agent: this.name, dedupeKey, runId: existing.id }, 'returning cached run output');
        return this.outputSchema.parse(existing.output);
      }
    }

    // Portfolio-wide kill switch — flipped from /operator when something looks
    // wrong (runaway spend, broken integration, customer escalation). Throws
    // before the agent_runs row is inserted, so a flipped switch shows up
    // upstream as a markEventFailed on the agent_events row rather than a
    // failed agent_runs row. That's the right treatment: the run never
    // started, so don't pretend it did.
    const sys = await getSystemState();
    if (sys.killSwitch) {
      throw new KillSwitchActiveError(this.name, sys.killSwitchReason);
    }

    await this.assertBudgetAvailable();

    const db = getDb();
    const [runRow] = await db
      .insert(agentRuns)
      .values({
        agent: this.name,
        dedupeKey: dedupeKey ?? null,
        status: 'running',
        input: input as object,
        siteId: opts.siteId ?? null,
        parentRunId: opts.parentRunId ?? null,
        // Stamp the source event so the reaper can correlate on
        // ar.source_event_id = agent_events.id rather than the old
        // dedupe_key = 'event:' || id hack (which broke for agents whose
        // dedupeKeyFn produces a domain key like 'niche:city:state').
        sourceEventId: opts.eventId ?? null,
      })
      .returning({ id: agentRuns.id });

    const runId = runRow!.id;
    const log = rootLog.child({ agent: this.name, runId });
    let totalCost = 0;
    let tokensIn = 0;
    let tokensOut = 0;

    // Progress throttle: an agent emitting per-iteration progress (e.g. one
    // call per generated page) shouldn't hammer the DB. Coalesce to ~1/sec
    // by buffering the latest call and flushing on a timer.
    let pendingProgress: { step?: number; total?: number; label: string } | null = null;
    let progressTimer: ReturnType<typeof setTimeout> | null = null;
    let progressInflight = false;
    const PROGRESS_INTERVAL_MS = 1000;

    const flushProgress = async () => {
      if (!pendingProgress || progressInflight) return;
      const next = pendingProgress;
      pendingProgress = null;
      progressInflight = true;
      try {
        await db
          .update(agentRuns)
          .set({
            progressMessage: next.label,
            progressStep: next.step ?? null,
            progressTotal: next.total ?? null,
            progressUpdatedAt: new Date(),
          })
          .where(eq(agentRuns.id, runId));
      } catch (err) {
        // Progress writes are best-effort — never break the agent run.
        log.warn({ err: err instanceof Error ? err.message : err }, 'progress update failed');
      } finally {
        progressInflight = false;
      }
    };

    const scheduleProgress = (entry: { step?: number; total?: number; label: string }) => {
      pendingProgress = entry;
      if (progressTimer) return;
      progressTimer = setTimeout(() => {
        progressTimer = null;
        void flushProgress();
      }, PROGRESS_INTERVAL_MS);
    };

    const ctx: AgentContext = {
      runId,
      log,
      parentRunId: opts.parentRunId ?? null,
      recordUsage: (u) => {
        totalCost += u.cost_usd;
        tokensIn += u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        tokensOut += u.output_tokens;
      },
      progress: (entry) => scheduleProgress(entry),
      emitNextStepEvent: async (args) => {
        // Suppress when running as a sub-agent. The parent orchestrator is
        // chaining the next step in-process; emitting here would spawn a
        // duplicate cron-driven pipeline. See cluster.ready cascade
        // incident 2026-05-07 ($85.53 burned) and 2026-05-08 (3 cascading
        // site-builder runs despite suppression check passing in source —
        // the diagnostic log below captures opts shape so we can debug).
        const parentRunIdAtEmit = opts.parentRunId;
        const suppress = parentRunIdAtEmit !== undefined;
        log.info(
          {
            event_type: args.type,
            target_agent: args.targetAgent,
            parent_run_id: parentRunIdAtEmit ?? null,
            suppressed: suppress,
          },
          suppress ? 'emitNextStepEvent suppressed (sub-agent)' : 'emitNextStepEvent firing',
        );
        if (suppress) return;
        await db.insert(agentEvents).values({
          agent: this.name,
          type: args.type,
          targetAgent: args.targetAgent,
          payload: args.payload,
        });
      },
    };

    try {
      log.info({ input }, 'agent run starting');
      const output = await this.execute(input, ctx);
      const validated = this.outputSchema.parse(output);

      // Clear any pending throttled progress write — the run is finishing
      // now and we're about to overwrite the row's progress columns.
      if (progressTimer) {
        clearTimeout(progressTimer);
        progressTimer = null;
      }
      pendingProgress = null;

      await db
        .update(agentRuns)
        .set({
          status: 'succeeded',
          output: validated as object,
          tokensIn,
          tokensOut,
          costUsd: totalCost.toFixed(4),
          endedAt: new Date(),
          progressMessage: null,
          progressStep: null,
          progressTotal: null,
          progressUpdatedAt: null,
        })
        .where(eq(agentRuns.id, runId));

      await this.creditBudget(totalCost);
      log.info({ tokensIn, tokensOut, costUsd: totalCost }, 'agent run succeeded');
      return validated;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status =
        err instanceof BudgetExceededError || err instanceof GlobalBudgetExceededError
          ? 'budget_exceeded'
          : 'failed';
      log.error({ err: message }, 'agent run failed');

      if (progressTimer) {
        clearTimeout(progressTimer);
        progressTimer = null;
      }
      pendingProgress = null;

      await db
        .update(agentRuns)
        .set({
          status,
          error: message,
          tokensIn,
          tokensOut,
          costUsd: totalCost.toFixed(4),
          endedAt: new Date(),
          progressMessage: null,
          progressStep: null,
          progressTotal: null,
          progressUpdatedAt: null,
        })
        .where(eq(agentRuns.id, runId));

      // Credit whatever was spent before failure so the daily cap can trip.
      // Wrapped in its own try/catch so a budget-write failure never masks
      // the original error.
      try {
        await this.creditBudget(totalCost);
      } catch (budgetErr) {
        log.warn({ err: budgetErr instanceof Error ? budgetErr.message : budgetErr }, 'creditBudget failed on error path');
      }

      if (err instanceof BudgetExceededError || err instanceof GlobalBudgetExceededError) throw err;
      throw new AgentRunError(this.name, message, err);
    }
  }

  protected async findExistingSuccess(dedupeKey: string) {
    const db = getDb();
    const rows = await db
      .select()
      .from(agentRuns)
      .where(
        and(eq(agentRuns.agent, this.name), eq(agentRuns.dedupeKey, dedupeKey), eq(agentRuns.status, 'succeeded')),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  protected async assertBudgetAvailable(): Promise<void> {
    const db = getDb();

    // ── Portfolio-wide daily cap (checked before the per-agent gate) ──
    // Atomic UTC-day reset of the global counter, anchored on
    // global_spend_reset_at so it's independent of system_state.updated_at
    // (which churns for kill-switch / operator writes). When the cap trips the
    // whole fleet pauses until the next UTC day; the queue releases the event
    // without consuming an attempt (failure_kind = global_budget).
    await db.execute(sql`
      UPDATE system_state
      SET global_spent_today_usd = 0, global_spend_reset_at = NOW()
      WHERE id = 'global'
        AND (global_spend_reset_at IS NULL
             OR date_trunc('day', global_spend_reset_at AT TIME ZONE 'UTC')
                < date_trunc('day', NOW() AT TIME ZONE 'UTC'))
    `);
    const [g] = await db
      .select({
        spent: systemState.globalSpentTodayUsd,
        cap: systemState.globalDailyCostCapUsd,
      })
      .from(systemState)
      .where(eq(systemState.id, 'global'))
      .limit(1);
    if (g && isOverGlobalBudget(Number(g.spent), Number(g.cap))) {
      throw new GlobalBudgetExceededError(Number(g.cap));
    }

    // ── Per-agent caps ──
    // Atomic UTC reset: zero spent_today_usd on day rollover and
    // spent_this_month_usd on month rollover. A month rollover always implies a
    // day rollover, so the day-rolled WHERE clause covers both. Without this the
    // cap permanently bricks an agent the first period it hits the limit.
    await db.execute(sql`
      UPDATE agent_budgets
      SET spent_today_usd = 0,
          spent_this_month_usd = CASE
            WHEN date_trunc('month', updated_at AT TIME ZONE 'UTC')
               < date_trunc('month', NOW() AT TIME ZONE 'UTC')
            THEN 0 ELSE spent_this_month_usd END,
          updated_at = NOW()
      WHERE agent = ${this.name}
        AND date_trunc('day', updated_at AT TIME ZONE 'UTC') < date_trunc('day', NOW() AT TIME ZONE 'UTC')
    `);
    const [row] = await db.select().from(agentBudgets).where(eq(agentBudgets.agent, this.name)).limit(1);
    // Order matters: enabled-check before spend-cap. Operator's mental model
    // for flipping the enabled flag is "stop now," not "stop on cap." If we
    // checked spend first, a disabled agent under cap would still report
    // BudgetExceeded once it eventually overflowed instead of the clearer
    // AgentDisabled signal.
    if (row && row.enabled === false) {
      throw new AgentDisabledError(this.name);
    }
    const cap = row ? Number(row.dailyCostCapUsd) : this.defaultDailyCapUsd;
    const spent = row ? Number(row.spentTodayUsd) : 0;
    if (spent >= cap) {
      throw new BudgetExceededError(this.name, cap);
    }
    const monthlyCap = row ? Number(row.monthlyCostCapUsd) : 0;
    const spentMonth = row ? Number(row.spentThisMonthUsd) : 0;
    if (isOverMonthlyBudget(spentMonth, monthlyCap)) {
      throw new BudgetExceededError(this.name, monthlyCap);
    }
  }

  protected async creditBudget(amountUsd: number): Promise<void> {
    if (amountUsd <= 0) return;
    const db = getDb();
    await db
      .insert(agentBudgets)
      .values({
        agent: this.name,
        dailyCostCapUsd: this.defaultDailyCapUsd.toFixed(2),
        spentTodayUsd: amountUsd.toFixed(4),
        spentThisMonthUsd: amountUsd.toFixed(4),
      })
      .onConflictDoUpdate({
        target: agentBudgets.agent,
        set: {
          // Reset spent to the current amount when updated_at is from a prior
          // UTC day; otherwise add to the running total. Mirrors the assert-
          // path reset so a credit racing across midnight lands on the new
          // day's tally rather than yesterday's.
          spentTodayUsd: sql`
            CASE
              WHEN date_trunc('day', ${agentBudgets.updatedAt} AT TIME ZONE 'UTC')
                 < date_trunc('day', NOW() AT TIME ZONE 'UTC')
              THEN ${amountUsd.toFixed(4)}::numeric
              ELSE ${agentBudgets.spentTodayUsd} + ${amountUsd.toFixed(4)}::numeric
            END
          `,
          // Same reset logic on the month boundary, so the monthly cap reads a
          // true month-to-date total.
          spentThisMonthUsd: sql`
            CASE
              WHEN date_trunc('month', ${agentBudgets.updatedAt} AT TIME ZONE 'UTC')
                 < date_trunc('month', NOW() AT TIME ZONE 'UTC')
              THEN ${amountUsd.toFixed(4)}::numeric
              ELSE ${agentBudgets.spentThisMonthUsd} + ${amountUsd.toFixed(4)}::numeric
            END
          `,
          updatedAt: new Date(),
        },
      });

    // Credit the portfolio-wide daily counter, resetting on the UTC-day
    // boundary anchored on global_spend_reset_at (mirrors the assert path).
    await db.execute(sql`
      UPDATE system_state
      SET global_spent_today_usd = CASE
            WHEN global_spend_reset_at IS NULL
              OR date_trunc('day', global_spend_reset_at AT TIME ZONE 'UTC')
                 < date_trunc('day', NOW() AT TIME ZONE 'UTC')
            THEN ${amountUsd.toFixed(4)}::numeric
            ELSE global_spent_today_usd + ${amountUsd.toFixed(4)}::numeric END,
          global_spend_reset_at = CASE
            WHEN global_spend_reset_at IS NULL
              OR date_trunc('day', global_spend_reset_at AT TIME ZONE 'UTC')
                 < date_trunc('day', NOW() AT TIME ZONE 'UTC')
            THEN NOW() ELSE global_spend_reset_at END,
          updated_at = NOW()
      WHERE id = 'global'
    `);
  }
}

/** Helper for stub agents to declare shape without importing zod everywhere. */
export const stubInput = z.object({}).passthrough();
export const stubOutput = z.object({}).passthrough();
export type StubInput = z.infer<typeof stubInput>;
export type StubOutput = z.infer<typeof stubOutput>;

export { randomUUID };
