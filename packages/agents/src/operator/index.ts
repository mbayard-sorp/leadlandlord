/**
 * Operator orchestrator (Phase F capstone).
 *
 * Highest-level decision-maker in the LeadLandlord agent fleet. Runs every
 * 10 minutes via cron, reads global state, and decides what work — if any —
 * to dispatch to the rest of the team.
 *
 * Distinct from the operator-tick cron at /api/cron/operator-tick: that
 * route is the EVENT dispatcher (drains agent_events). This agent SCHEDULES
 * new work by emitting events.
 *
 * Decision tree (executed in priority order — first match emits and returns):
 *   a. Pause runaway agent: any agent ≥ 1.2× its daily cap is auto-disabled.
 *   b. Niche approval: top pending niche (score≥75) auto-approved if mode is
 *      autonomous + autoApproveNiches=true. Cap 1 per run.
 *   c. Domain search dispatch: warming sites without domains get search.
 *   d. Auto-approve domain candidate: top-rank candidate ≤ budget, autonomous only.
 *   e. Cross-sell adjacent cities: pick a sister-city niche for a stable tenant.
 *   f. No-op fallback.
 *
 * Idempotency: dedupe key includes the YYYY-MM-DD-HH-MM, so if the cron
 * fires twice in the same minute the second invocation short-circuits to
 * the cached output via BaseAgent.findExistingSuccess.
 *
 * Safety: defaultDailyCapUsd is $2 — the orchestrator does small reads and
 * emits, almost zero LLM cost. The cap exists to bound runaway loops, not
 * to budget actual spend.
 */
import { z } from 'zod';
import { sql, and, eq, desc } from 'drizzle-orm';
import {
  getDb,
  agentBudgets,
  agentEvents,
  niches,
  sites,
  tenants,
  domainCandidates,
  systemState,
  portfolioSnapshots,
  getSystemState,
} from '@leadlandlord/db';
import { BaseAgent, type AgentContext } from '../base';

// ────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────

export const OperatorInput = z.object({});
export type OperatorInput = z.infer<typeof OperatorInput>;

export const OperatorDecisionType = z.enum([
  'niche_approve',
  'domain_search',
  'site_build',
  'cross_sell',
  'pause_agent',
  'resume_agent',
  'no_op',
]);
export type OperatorDecisionType = z.infer<typeof OperatorDecisionType>;

export const OperatorDecision = z.object({
  type: OperatorDecisionType,
  target: z.string(),
  rationale: z.string(),
  eventEmitted: z.string().nullable(),
});
export type OperatorDecision = z.infer<typeof OperatorDecision>;

export const OperatorMode = z.enum(['manual', 'supervised', 'autonomous']);
export type OperatorMode = z.infer<typeof OperatorMode>;

export const OperatorOutput = z.object({
  decisions: z.array(OperatorDecision),
  kpis: z.object({
    currentMrrUsd: z.number(),
    targetMrrUsd: z.number(),
    activeSites: z.number(),
    targetActiveSites: z.number(),
    margin: z.number(),
  }),
  modeUsed: OperatorMode,
});
export type OperatorOutput = z.infer<typeof OperatorOutput>;

// ────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────

/**
 * Build a YYYY-MM-DD-HH-MM bucket from a timestamp. The dedupe key uses this
 * so a cron that fires twice in the same minute collapses to one run.
 */
export function operatorMinuteBucket(now = new Date()): string {
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d}-${h}-${mi}`;
}

/**
 * Returns true when the runaway-agent rule should fire — spend has exceeded
 * 1.2× the daily cap (defense-in-depth on top of BaseAgent's own cap).
 */
export function isRunawayAgent(spentTodayUsd: number, dailyCapUsd: number): boolean {
  if (dailyCapUsd <= 0) return false;
  return spentTodayUsd > dailyCapUsd * 1.2;
}

/**
 * Margin = (mrr30d - costs30d) / mrr30d. Returns 0 when MRR is zero so we
 * don't divide-by-zero into NaN.
 */
export function computeMargin(mrr30d: number, costs30d: number): number {
  if (mrr30d <= 0) return 0;
  return (mrr30d - costs30d) / mrr30d;
}

// ────────────────────────────────────────────────────────────
// Internal types for decision tree
// ────────────────────────────────────────────────────────────

interface RunawayRow {
  agent: string;
  spent: number;
  cap: number;
}

function rowsOf<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (Array.isArray((r as any)?.rows)) return (r as any).rows as T[];
  return [];
}

// ────────────────────────────────────────────────────────────
// Agent
// ────────────────────────────────────────────────────────────

export class Operator extends BaseAgent<typeof OperatorInput, typeof OperatorOutput> {
  constructor() {
    super({
      name: 'operator',
      inputSchema: OperatorInput,
      outputSchema: OperatorOutput,
      defaultDailyCapUsd: 2,
      dedupeKeyFn: () => `operator:${operatorMinuteBucket()}`,
    });
  }

  protected async execute(
    _input: OperatorInput,
    ctx: AgentContext,
  ): Promise<OperatorOutput> {
    const db = getDb();
    const sys = await getSystemState();
    const mode = OperatorMode.parse(sys.operatorMode ?? 'manual');

    // Compute KPIs unconditionally — even when disabled we want them in the
    // output so the operator UI has fresh numbers without a separate query.
    const kpis = await this.computeKpis();

    // Short-circuit: operator opt-in. Stays off until a human flips it.
    if (!sys.operatorEnabled) {
      ctx.log.info({ mode }, 'operator disabled; emitting no_op');
      const decisions: OperatorDecision[] = [
        {
          type: 'no_op',
          target: '-',
          rationale: 'operator_disabled',
          eventEmitted: null,
        },
      ];
      return { decisions, kpis, modeUsed: mode };
    }

    const decisions: OperatorDecision[] = [];

    // ── (a) Pause runaway agent ─────────────────────────────
    const runaway = await this.findRunawayAgent();
    if (runaway) {
      await db
        .update(agentBudgets)
        .set({ enabled: false, updatedAt: new Date() })
        .where(eq(agentBudgets.agent, runaway.agent));
      ctx.log.warn(
        { agent: runaway.agent, spent: runaway.spent, cap: runaway.cap },
        'operator paused runaway agent',
      );
      decisions.push({
        type: 'pause_agent',
        target: runaway.agent,
        rationale: `spent_today $${runaway.spent.toFixed(2)} > 1.2× cap $${runaway.cap.toFixed(2)}`,
        eventEmitted: null,
      });
      await this.markRun(db);
      return { decisions, kpis, modeUsed: mode };
    }

    // ── (b) Niche approval ──────────────────────────────────
    if (
      (mode === 'supervised' || mode === 'autonomous') &&
      sys.autoApproveNiches &&
      mode === 'autonomous'
    ) {
      // Only autonomous mode actually flips the row. Supervised mode is
      // reserved for a future "queue for human review" path; for now we
      // treat it as identical to manual w.r.t. niches.
      const top = await db
        .select()
        .from(niches)
        .where(and(eq(niches.decision, 'pending'), sql`${niches.score} >= 75`))
        .orderBy(desc(niches.score))
        .limit(1);
      const target = top[0];
      if (target) {
        await db
          .update(niches)
          .set({ decision: 'approved', decidedAt: new Date() })
          .where(eq(niches.id, target.id));
        await db.insert(agentEvents).values({
          agent: 'operator',
          type: 'niche.approved',
          targetAgent: 'site-builder',
          payload: {
            nicheId: target.id,
            niche: target.niche,
            city: target.city,
            state: target.state,
          },
        });
        ctx.log.info(
          { nicheId: target.id, niche: target.niche, city: target.city, score: target.score },
          'operator auto-approved niche',
        );
        decisions.push({
          type: 'niche_approve',
          target: `${target.niche} / ${target.city}, ${target.state}`,
          rationale: `score=${target.score ?? '?'} ≥ 75; autonomous + auto_approve_niches`,
          eventEmitted: 'niche.approved',
        });
        await this.markRun(db);
        return { decisions, kpis, modeUsed: mode };
      }
    }

    // ── (c) Domain search dispatch ──────────────────────────
    const domainSearchTargets = rowsOf<{ id: string; niche: string; city: string; state: string }>(
      await db.execute(sql`
        SELECT s.id, s.niche, s.city, s.state
        FROM ${sites} s
        WHERE s.status = 'warming'
          AND s.domain IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM ${domainCandidates} dc WHERE dc.site_id = s.id
          )
        ORDER BY s.created_at ASC
        LIMIT 3
      `),
    );
    if (domainSearchTargets.length > 0) {
      for (const site of domainSearchTargets) {
        await db.insert(agentEvents).values({
          agent: 'operator',
          type: 'domain.search-requested',
          targetAgent: 'domain-procurer',
          payload: {
            siteId: site.id,
            niche: site.niche,
            city: site.city,
            state: site.state,
          },
        });
        decisions.push({
          type: 'domain_search',
          target: `${site.niche} / ${site.city}, ${site.state}`,
          rationale: 'warming site has no domain and no candidates yet',
          eventEmitted: 'domain.search-requested',
        });
      }
      ctx.log.info({ count: decisions.length }, 'operator dispatched domain search');
      await this.markRun(db);
      return { decisions, kpis, modeUsed: mode };
    }

    // ── (d) Auto-approve domain candidate (autonomous only) ─
    if (mode === 'autonomous' && Number(sys.autoApproveDomainBudgetUsd) > 0) {
      const budget = Number(sys.autoApproveDomainBudgetUsd);
      const cand = rowsOf<{ id: string; site_id: string; domain: string; price: number }>(
        await db.execute(sql`
          SELECT dc.id, dc.site_id, dc.domain, dc.price_usd::float AS price
          FROM ${domainCandidates} dc
          INNER JOIN ${sites} s ON s.id = dc.site_id
          WHERE s.status = 'warming'
            AND dc.status = 'pending_approval'
            AND dc.price_usd IS NOT NULL
            AND dc.price_usd <= ${budget}
          ORDER BY dc.rank ASC
          LIMIT 1
        `),
      )[0];
      if (cand) {
        await db
          .update(domainCandidates)
          .set({ status: 'approved' })
          .where(eq(domainCandidates.id, cand.id));
        await db.insert(agentEvents).values({
          agent: 'operator',
          type: 'domain.approval.granted',
          targetAgent: 'domain-procurer',
          payload: {
            siteId: cand.site_id,
            domainCandidateId: cand.id,
            domain: cand.domain,
            priceUsd: cand.price,
          },
        });
        decisions.push({
          type: 'site_build',
          target: cand.domain,
          rationale: `auto-approved domain at $${cand.price.toFixed(2)} (≤ $${budget.toFixed(2)} budget)`,
          eventEmitted: 'domain.approval.granted',
        });
        ctx.log.info(
          { domain: cand.domain, price: cand.price, budget },
          'operator auto-approved domain candidate',
        );
        await this.markRun(db);
        return { decisions, kpis, modeUsed: mode };
      }
    }

    // ── (e) Cross-sell adjacent cities (autonomous only) ────
    if (mode === 'autonomous') {
      // Find an active tenant ≥ 30 days, then look for a same-niche / different-
      // city pending niche with score ≥ 60 and approve it.
      const stable = rowsOf<{ niche: string; city: string }>(
        await db.execute(sql`
          SELECT s.niche, s.city
          FROM ${tenants} t
          INNER JOIN ${sites} s ON s.id = t.site_id
          WHERE t.status = 'active'
            AND t.started_at IS NOT NULL
            AND t.started_at <= NOW() - INTERVAL '30 days'
          ORDER BY t.started_at ASC
          LIMIT 5
        `),
      );
      for (const seed of stable) {
        const sister = await db
          .select()
          .from(niches)
          .where(
            and(
              eq(niches.niche, seed.niche),
              eq(niches.decision, 'pending'),
              sql`${niches.city} <> ${seed.city}`,
              sql`${niches.score} >= 60`,
            ),
          )
          .orderBy(desc(niches.score))
          .limit(1);
        const pick = sister[0];
        if (pick) {
          await db
            .update(niches)
            .set({ decision: 'approved', decidedAt: new Date() })
            .where(eq(niches.id, pick.id));
          await db.insert(agentEvents).values({
            agent: 'operator',
            type: 'niche.approved',
            targetAgent: 'site-builder',
            payload: {
              nicheId: pick.id,
              niche: pick.niche,
              city: pick.city,
              state: pick.state,
              crossSellFromCity: seed.city,
            },
          });
          decisions.push({
            type: 'cross_sell',
            target: `${pick.niche} / ${pick.city}, ${pick.state}`,
            rationale: `sister city of stable tenant ${seed.niche}/${seed.city}; score=${pick.score ?? '?'}`,
            eventEmitted: 'niche.approved',
          });
          ctx.log.info(
            { fromCity: seed.city, toCity: pick.city, niche: pick.niche },
            'operator dispatched cross-sell',
          );
          await this.markRun(db);
          return { decisions, kpis, modeUsed: mode };
        }
      }
    }

    // ── (f) No-op fallback ──────────────────────────────────
    decisions.push({
      type: 'no_op',
      target: '-',
      rationale: 'all_systems_green',
      eventEmitted: null,
    });
    await this.markRun(db);
    return { decisions, kpis, modeUsed: mode };
  }

  // ────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────

  /** Stamp lastOperatorRunAt on the singleton row for heartbeat purposes. */
  private async markRun(db: ReturnType<typeof getDb>): Promise<void> {
    await db
      .update(systemState)
      .set({ lastOperatorRunAt: new Date(), updatedAt: new Date() })
      .where(eq(systemState.id, 'global'));
  }

  /** Find the first agent whose spentTodayUsd exceeds 1.2× its daily cap. */
  private async findRunawayAgent(): Promise<RunawayRow | null> {
    const db = getDb();
    const rows = await db.select().from(agentBudgets);
    for (const r of rows) {
      const spent = Number(r.spentTodayUsd);
      const cap = Number(r.dailyCostCapUsd);
      // Skip already-disabled agents — pausing again is a no-op.
      if (r.enabled === false) continue;
      if (isRunawayAgent(spent, cap)) {
        return { agent: r.agent, spent, cap };
      }
    }
    return null;
  }

  /** Compute current MRR, active sites, and 30-day margin. */
  private async computeKpis(): Promise<OperatorOutput['kpis']> {
    const db = getDb();
    const sys = await getSystemState();

    // Current MRR — sum of monthly_rent_usd across active tenants.
    const mrrRows = rowsOf<{ mrr: string }>(
      await db.execute(sql`
        SELECT COALESCE(SUM(monthly_rent_usd), 0)::text AS mrr
        FROM ${tenants}
        WHERE status = 'active'
      `),
    );
    const currentMrrUsd = Number(mrrRows[0]?.mrr ?? '0');

    // Active sites: warming | live | rented.
    const sitesRows = rowsOf<{ c: number }>(
      await db.execute(sql`
        SELECT COUNT(*)::int AS c
        FROM ${sites}
        WHERE status IN ('warming', 'live', 'rented')
      `),
    );
    const activeSites = Number(sitesRows[0]?.c ?? 0);

    // 30-day MRR/costs from portfolio_snapshots portfolio-wide rows.
    const portfolioRows = rowsOf<{ mrr: string; costs: string }>(
      await db.execute(sql`
        SELECT
          COALESCE(SUM(mrr_usd), 0)::text AS mrr,
          COALESCE(SUM(costs_usd), 0)::text AS costs
        FROM ${portfolioSnapshots}
        WHERE site_id IS NULL
          AND niche IS NULL
          AND date >= (CURRENT_DATE - INTERVAL '30 days')::text
      `),
    );
    const mrr30d = Number(portfolioRows[0]?.mrr ?? '0');
    const costs30d = Number(portfolioRows[0]?.costs ?? '0');
    const margin = computeMargin(mrr30d, costs30d);

    return {
      currentMrrUsd,
      targetMrrUsd: Number(sys.targetMrrUsd ?? '0'),
      activeSites,
      targetActiveSites: Number(sys.targetActiveSites ?? 0),
      margin,
    };
  }
}
