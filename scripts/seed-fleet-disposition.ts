import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, agentBudgets, agentSchedules, setGlobalDailyCostCap, eq } from '@leadlandlord/db';
import { agentRegistry } from '@leadlandlord/agents/registry';
import {
  FLEET_DISPOSITION,
  GLOBAL_DAILY_COST_CAP_START_USD,
  summarizeDisposition,
} from '@leadlandlord/agents/orchestrator';

/**
 * Activate the agreed fleet disposition (orchestrator Phase 4, plan Appendix A).
 * Idempotent: re-running yields the same agent_budgets ON/OFF + caps and the
 * same global cap. Cadence already seeded in Phase 3 (seed-agent-schedules).
 *
 * Run ONCE to activate, then tune caps via fleet-config from the digest. The
 * global kill switch (system_state.kill_switch) remains the instant stop.
 */

// Agents in the disposition that are not (yet) in the registry: the two new
// agents built in later phases + the two deferred stubs.
const KNOWN_EXTRAS = new Set(['fleet-digest', 'orchestrator', 'backlink-copycat', 'citation-runner']);

async function main() {
  const registryKeys = Object.keys(agentRegistry);

  // Honesty checks: the registry wins. Every registry kind must have a
  // disposition; disposition keys must be registry kinds or known extras.
  const missing = registryKeys.filter((k) => !(k in FLEET_DISPOSITION));
  if (missing.length > 0) {
    throw new Error(`registry kinds missing from FLEET_DISPOSITION: ${missing.join(', ')}`);
  }
  const stray = Object.keys(FLEET_DISPOSITION).filter(
    (k) => !registryKeys.includes(k) && !KNOWN_EXTRAS.has(k),
  );
  if (stray.length > 0) {
    throw new Error(`FLEET_DISPOSITION has keys that are neither registry kinds nor known extras: ${stray.join(', ')}`);
  }

  const db = getDb();

  // 1. agent_budgets: ON/OFF + conservative daily caps.
  for (const [agent, d] of Object.entries(FLEET_DISPOSITION)) {
    await db
      .insert(agentBudgets)
      .values({
        agent,
        enabled: d.enabled,
        dailyCostCapUsd: d.dailyCapUsd.toFixed(2),
      })
      .onConflictDoUpdate({
        target: agentBudgets.agent,
        set: {
          enabled: d.enabled,
          dailyCostCapUsd: d.dailyCapUsd.toFixed(2),
          updatedAt: new Date(),
        },
      });
  }

  // 2. agent_schedules: pause the cadence of disabled agents so the tick stops
  //    enqueuing them (belt-and-suspenders with the enabled-filter). Enabled
  //    agents get paused=false. Unknown target (e.g. molly-nudge -> 'molly') is
  //    treated as paused.
  const schedules = await db.select().from(agentSchedules);
  for (const row of schedules) {
    const target = row.targetAgent;
    const d = target ? FLEET_DISPOSITION[target] : undefined;
    const paused = d ? !d.enabled : true;
    await db
      .update(agentSchedules)
      .set({ paused, managedBy: 'human', updatedAt: new Date() })
      .where(eq(agentSchedules.schedulerName, row.schedulerName));
  }

  // 3. Global daily spend ceiling.
  await setGlobalDailyCostCap(GLOBAL_DAILY_COST_CAP_START_USD);

  // 4. Report + verify the split.
  const summary = summarizeDisposition();
  console.log(
    `\nFleet disposition applied: ${summary.enabled.length} ON (scheduled) + ` +
      `${summary.armed.length} armed (event/manual) + ${summary.disabled.length} disabled. ` +
      `Global daily cap = $${GLOBAL_DAILY_COST_CAP_START_USD}.`,
  );
  console.log(`  armed (never on a timer): ${summary.armed.join(', ')}`);
  console.log(`  disabled: ${summary.disabled.join(', ')}`);

  const rows = await db.select().from(agentBudgets);
  const enabledCount = rows.filter((r) => r.enabled).length;
  console.log(
    `\nagent_budgets: ${rows.length} rows, ${enabledCount} enabled, ${rows.length - enabledCount} disabled.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
