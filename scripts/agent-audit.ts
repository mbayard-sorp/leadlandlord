import { config } from 'dotenv';
config({ path: '.env.local' });

// Belt-and-suspenders: make every outbound integration refuse real sends for
// the duration of the audit. The audit is static (it never executes agents),
// but this guarantees zero emails / numbers / charges regardless.
process.env.AGENT_AUDIT = '1';

import { getDb, agentHealth, agentRuns, gte, desc } from '@leadlandlord/db';
import { agentRegistry } from '@leadlandlord/agents/registry';
import {
  buildAuditRows,
  summarizeAudit,
  summarizeRunHistory,
  type RunRecord,
} from '@leadlandlord/agents/audit';

const HISTORY_WINDOW_DAYS = 30;

async function main() {
  const now = new Date();
  const db = getDb();
  const registryKeys = Object.keys(agentRegistry);

  // Pull recent terminal+in-flight runs (newest first) to derive per-agent
  // history. Read-only; no agent is executed.
  const since = new Date(now.getTime() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const runs = (await db
    .select({
      agent: agentRuns.agent,
      status: agentRuns.status,
      startedAt: agentRuns.startedAt,
      error: agentRuns.error,
    })
    .from(agentRuns)
    .where(gte(agentRuns.startedAt, since))
    .orderBy(desc(agentRuns.startedAt))) as RunRecord[];

  const history = summarizeRunHistory(runs);
  const rows = buildAuditRows({ registryKeys, env: process.env, history, now });

  for (const row of rows) {
    await db
      .insert(agentHealth)
      .values(row)
      .onConflictDoUpdate({
        target: agentHealth.agent,
        set: {
          auditStatus: row.auditStatus,
          lastAuditAt: row.lastAuditAt,
          lastRunAt: row.lastRunAt,
          lastSuccessAt: row.lastSuccessAt,
          lastFailureAt: row.lastFailureAt,
          consecutiveFailures: row.consecutiveFailures,
          lastError: row.lastError,
          requiredEnv: row.requiredEnv,
          notes: row.notes,
          updatedAt: row.updatedAt,
        },
      });
  }

  const summary = summarizeAudit(rows);
  console.log(`\nFleet audit — ${summary.total} agents (${registryKeys.length} registry + deferred)`);
  console.log(
    `  pass=${summary.byStatus.pass}  needs_creds=${summary.byStatus.needs_creds}  ` +
      `not_implemented=${summary.byStatus.not_implemented}  fail=${summary.byStatus.fail}  ` +
      `skipped=${summary.byStatus.skipped}\n`,
  );
  for (const line of summary.lines) console.log(line);
  console.log(`\nWrote ${rows.length} rows to agent_health.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
