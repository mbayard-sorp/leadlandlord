/**
 * Shared orchestrator context (orchestrator Phase 3+).
 *
 * Read-only fleet snapshot + state helpers used by the operator/tick
 * supervisory pass now, and by the Phase 6 chat brain later — one module, no
 * duplication. See docs/orchestrator-plan.md §3.2.
 */
import { getDb, agentHealth, agentBudgets } from '@leadlandlord/db';

/**
 * The legible, human-facing agent state derived from the two independent
 * gates (agent_budgets.enabled + agent_schedules.paused). Never surface the
 * raw boolean pair in orchestrator output — collapse to this union.
 *
 *   active      — enabled + scheduled on a cadence (cron/poll)
 *   demand_only — enabled but not on a cadence (paused, or event/manual)
 *   disabled    — not enabled (won't run at all)
 */
export type EffectiveAgentState = 'active' | 'demand_only' | 'disabled';

export function getEffectiveAgentState(
  enabled: boolean,
  paused: boolean,
  cadenceKind: string | null,
): EffectiveAgentState {
  if (!enabled) return 'disabled';
  if (paused) return 'demand_only';
  if (cadenceKind === 'cron' || cadenceKind === 'poll') return 'active';
  return 'demand_only';
}

export interface FleetHealthRow {
  agent: string;
  /** From agent_budgets.enabled; a missing budget row counts as enabled. */
  enabled: boolean;
  consecutiveFailures: number;
  auditStatus: string;
  lastError: string | null;
}

/**
 * Join agent_health with agent_budgets enabled-state. Read-only. Callers wrap
 * this defensively — it throws if agent_health doesn't exist yet (migration
 * 0036 unapplied), which the supervisor treats as "no-op this pass".
 */
export async function readFleetHealth(): Promise<FleetHealthRow[]> {
  const db = getDb();
  const budgets = await db
    .select({ agent: agentBudgets.agent, enabled: agentBudgets.enabled })
    .from(agentBudgets);
  const enabledByAgent = new Map(budgets.map((b) => [b.agent, b.enabled]));
  const health = await db
    .select({
      agent: agentHealth.agent,
      consecutiveFailures: agentHealth.consecutiveFailures,
      auditStatus: agentHealth.auditStatus,
      lastError: agentHealth.lastError,
    })
    .from(agentHealth);
  return health.map((h) => ({
    agent: h.agent,
    enabled: enabledByAgent.get(h.agent) ?? true,
    consecutiveFailures: h.consecutiveFailures,
    auditStatus: h.auditStatus,
    lastError: h.lastError,
  }));
}
