import { randomUUID } from 'node:crypto';
import { eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, agentRuns, agentBudgets } from '@leadlandlord/db';
import { AgentRunError, BudgetExceededError } from '@leadlandlord/shared/errors';
import { log as rootLog, type Logger } from '@leadlandlord/shared/log';

export interface AgentContext {
  runId: string;
  log: Logger;
  /** Subclasses call this whenever they make an LLM call so cost tracking flows up. */
  recordUsage(args: {
    model: string;
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    cost_usd: number;
  }): void;
}

export interface AgentRunOptions {
  dedupeKey?: string;
  parentRunId?: string;
  siteId?: string;
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
    const dedupeKey = opts.dedupeKey ?? this.dedupeKeyFn?.(input);

    // Idempotent short-circuit: if we already succeeded for this dedupe key, return that output.
    if (dedupeKey) {
      const existing = await this.findExistingSuccess(dedupeKey);
      if (existing) {
        rootLog.info({ agent: this.name, dedupeKey, runId: existing.id }, 'returning cached run output');
        return this.outputSchema.parse(existing.output);
      }
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
      })
      .returning({ id: agentRuns.id });

    const runId = runRow!.id;
    const log = rootLog.child({ agent: this.name, runId });
    let totalCost = 0;
    let tokensIn = 0;
    let tokensOut = 0;

    const ctx: AgentContext = {
      runId,
      log,
      recordUsage: (u) => {
        totalCost += u.cost_usd;
        tokensIn += u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        tokensOut += u.output_tokens;
      },
    };

    try {
      log.info({ input }, 'agent run starting');
      const output = await this.execute(input, ctx);
      const validated = this.outputSchema.parse(output);

      await db
        .update(agentRuns)
        .set({
          status: 'succeeded',
          output: validated as object,
          tokensIn,
          tokensOut,
          costUsd: totalCost.toFixed(4),
          endedAt: new Date(),
        })
        .where(eq(agentRuns.id, runId));

      await this.creditBudget(totalCost);
      log.info({ tokensIn, tokensOut, costUsd: totalCost }, 'agent run succeeded');
      return validated;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof BudgetExceededError ? 'budget_exceeded' : 'failed';
      log.error({ err: message }, 'agent run failed');
      await db
        .update(agentRuns)
        .set({
          status,
          error: message,
          tokensIn,
          tokensOut,
          costUsd: totalCost.toFixed(4),
          endedAt: new Date(),
        })
        .where(eq(agentRuns.id, runId));
      if (err instanceof BudgetExceededError) throw err;
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
    const [row] = await db.select().from(agentBudgets).where(eq(agentBudgets.agent, this.name)).limit(1);
    const cap = row ? Number(row.dailyCostCapUsd) : this.defaultDailyCapUsd;
    const spent = row ? Number(row.spentTodayUsd) : 0;
    if (spent >= cap) {
      throw new BudgetExceededError(this.name, cap);
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
      })
      .onConflictDoUpdate({
        target: agentBudgets.agent,
        set: {
          spentTodayUsd: sql`${agentBudgets.spentTodayUsd} + ${amountUsd.toFixed(4)}`,
          updatedAt: new Date(),
        },
      });
  }
}

/** Helper for stub agents to declare shape without importing zod everywhere. */
export const stubInput = z.object({}).passthrough();
export const stubOutput = z.object({}).passthrough();
export type StubInput = z.infer<typeof stubInput>;
export type StubOutput = z.infer<typeof stubOutput>;

export { randomUUID };
