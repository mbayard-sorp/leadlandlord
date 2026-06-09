/**
 * Orchestrator supervisory pass (orchestrator Phase 3).
 *
 * Auto-disables agents that fail repeatedly (complementing the operator's
 * existing >1.2x-cap runaway-spender disable). Runs from the 10-minute tick —
 * NOT from inside the budget-gated operator agent — so it keeps working even
 * during a global-budget pause. The same module backs the Phase 6 chat brain.
 */
import { getDb, agentBudgets, agentSchedules, eq } from '@leadlandlord/db';
import { readFleetHealth, type FleetHealthRow } from './context';
import { raiseQuestion } from './tools';

export const CONSECUTIVE_FAILURE_DISABLE_THRESHOLD = 3;

/**
 * Agents the orchestrator must never auto-disable: itself / the operator (it
 * runs supervision) and the digest (it must keep reporting even while flapping).
 * Disabling never triggers site creation (that needs human niche approval), so
 * the human-gated build chain is safe to auto-disable.
 */
export const NEVER_AUTO_DISABLE: ReadonlySet<string> = new Set([
  'operator',
  'orchestrator',
  'fleet-digest',
]);

export interface SupervisionAction {
  kind: 'disable_agent';
  agent: string;
  reason: string;
}

export interface SupervisionResult {
  actions: SupervisionAction[];
  /** Set when the pass was a no-op because the read failed (e.g. table missing). */
  skipped?: string;
}

/**
 * The orchestrator master switch. A missing agent_budgets row means "on"
 * (default), so a fresh DB supervises until explicitly turned off. Toggled
 * from /operator/orchestrator by flipping agent_budgets.enabled for
 * 'orchestrator' — the SAME flag BaseAgent checks for the chat brain, so one
 * lever stops both the brain and this tick-driven pass.
 */
export function isOrchestratorEnabled(row: { enabled: boolean } | undefined): boolean {
  return row ? row.enabled : true;
}

/** Pure: pick which enabled agents have crossed the consecutive-failure threshold. */
export function selectAgentsToDisable(
  rows: FleetHealthRow[],
  threshold: number = CONSECUTIVE_FAILURE_DISABLE_THRESHOLD,
  neverDisable: ReadonlySet<string> = NEVER_AUTO_DISABLE,
): SupervisionAction[] {
  return rows
    .filter(
      (r) => r.enabled && r.consecutiveFailures >= threshold && !neverDisable.has(r.agent),
    )
    .map((r) => ({
      kind: 'disable_agent' as const,
      agent: r.agent,
      reason:
        `auto-disabled: ${r.consecutiveFailures} consecutive failures` +
        (r.lastError ? ` (last: ${r.lastError.slice(0, 120)})` : ''),
    }));
}

interface SupervisionLogger {
  warn: (obj: unknown, msg: string) => void;
}

/**
 * Read fleet health, disable repeat-failure agents, and pause their cadence.
 * Defensive: if agent_health is unavailable (migration unapplied), returns a
 * no-op result rather than throwing into the tick.
 */
export async function runSupervisionPass(logger?: SupervisionLogger): Promise<SupervisionResult> {
  // Master switch: when the orchestrator is turned off (agent_budgets.enabled =
  // false for 'orchestrator', toggled from /operator/orchestrator), the
  // tick-driven supervision no-ops too. Fail-safe-on: if the flag can't be read,
  // supervision still runs.
  try {
    const db = getDb();
    const [orchRow] = await db
      .select({ enabled: agentBudgets.enabled })
      .from(agentBudgets)
      .where(eq(agentBudgets.agent, 'orchestrator'));
    if (!isOrchestratorEnabled(orchRow)) {
      return { actions: [], skipped: 'orchestrator disabled' };
    }
  } catch (err) {
    logger?.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'orchestrator: enabled-check failed; running supervision (fail-safe-on)',
    );
  }

  let rows: FleetHealthRow[];
  try {
    rows = await readFleetHealth();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.warn({ err: msg }, 'orchestrator supervision skipped (agent_health read failed)');
    return { actions: [], skipped: msg };
  }

  const actions = selectAgentsToDisable(rows);
  if (actions.length === 0) return { actions: [] };

  const db = getDb();
  for (const a of actions) {
    await db
      .update(agentBudgets)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(agentBudgets.agent, a.agent));
    // Best-effort: also pause the cadence row so it stops being scheduled.
    try {
      await db
        .update(agentSchedules)
        .set({ paused: true, managedBy: 'orchestrator', notes: a.reason, updatedAt: new Date() })
        .where(eq(agentSchedules.targetAgent, a.agent));
    } catch {
      /* agent_schedules may not exist yet — the disable above is what matters */
    }

    // Phase 6 hook (deferred in Phase 3): open a question thread + email Mike so
    // the auto-disable is visible and he can decide whether to re-enable. The
    // disable itself is the audited action row inside that thread. Best-effort:
    // a failure here (e.g. orchestrator_messages unmigrated) must not undo the
    // disable, so swallow and log.
    try {
      await raiseQuestion({
        title: `Auto-disabled ${a.agent}`,
        question: `I auto-disabled ${a.agent} after repeated failures. ${a.reason}. Want me to re-enable it, or is this expected while you investigate?`,
        actions: [
          {
            summary: a.reason,
            metadata: { tool: 'disable_agent', agent: a.agent, source: 'supervision', after: { enabled: false } },
          },
        ],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger?.warn({ err: msg, agent: a.agent }, 'orchestrator: raiseQuestion failed after auto-disable');
    }
  }
  return { actions };
}
