import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb, agentSchedules } from '@leadlandlord/db';
import { schedulers } from '@leadlandlord/agents/scheduler';

/**
 * Seed agent_schedules with the CURRENT cadences (orchestrator Phase 3),
 * matching vercel.json + the hardcoded poll list EXACTLY so the cutover to the
 * DB-driven tick changes nothing. Idempotent: re-running updates the cadence
 * definition (managed_by='human') but preserves runtime state (last_enqueued_at,
 * paused) so it never clobbers an orchestrator-applied pause.
 *
 * Keyed on SCHEDULER name (the runScheduler() argument), not agent kind.
 * Phase 4 (seed-fleet-disposition) layers the ON/OFF + intended cadence on top.
 */

interface SeedRow {
  schedulerName: string;
  targetAgent: string;
  cadenceKind: 'cron' | 'poll' | 'manual';
  cronExpr?: string;
  intervalMinutes?: number;
}

// Sub-hourly pollers — currently run every 10-minute tick.
const POLL_INTERVAL = 10;
const SEED: SeedRow[] = [
  { schedulerName: 'operator', targetAgent: 'operator', cadenceKind: 'poll', intervalMinutes: POLL_INTERVAL },
  { schedulerName: 'network-linker', targetAgent: 'network-linker', cadenceKind: 'poll', intervalMinutes: POLL_INTERVAL },
  { schedulerName: 'molly-inbox', targetAgent: 'molly-inbox', cadenceKind: 'poll', intervalMinutes: POLL_INTERVAL },
  // molly-nudge feeds the (unregistered, deferred) 'molly' kind; kept at parity.
  { schedulerName: 'molly-nudge', targetAgent: 'molly', cadenceKind: 'poll', intervalMinutes: POLL_INTERVAL },

  // Daily/weekly crons — verbatim from apps/operator/vercel.json.
  { schedulerName: 'seo-ingest-gsc', targetAgent: 'seo-ingest-gsc', cadenceKind: 'cron', cronExpr: '0 6 * * *' },
  { schedulerName: 'seo-ingest-ga4', targetAgent: 'seo-ingest-ga4', cadenceKind: 'cron', cronExpr: '15 6 * * *' },
  { schedulerName: 'maintenance', targetAgent: 'maintenance', cadenceKind: 'cron', cronExpr: '0 7 * * *' },
  { schedulerName: 'lighthouse-audit', targetAgent: 'lighthouse-audit', cadenceKind: 'cron', cronExpr: '0 7 * * 1' },
  { schedulerName: 'seo-operator', targetAgent: 'seo-operator', cadenceKind: 'cron', cronExpr: '0 8 * * 1' },
  { schedulerName: 'local-content-scout', targetAgent: 'local-content-scout', cadenceKind: 'cron', cronExpr: '0 9 * * *' },
  { schedulerName: 'content-data-auditor', targetAgent: 'content-data-auditor', cadenceKind: 'cron', cronExpr: '0 10 * * 3' },
  { schedulerName: 'tenant-prospector', targetAgent: 'tenant-prospector', cadenceKind: 'cron', cronExpr: '0 14 * * 1' },
  { schedulerName: 'molly-digest', targetAgent: 'molly-digest', cadenceKind: 'cron', cronExpr: '0 14 * * *' },
  { schedulerName: 'outreach-agent', targetAgent: 'outreach-agent', cadenceKind: 'cron', cronExpr: '0 15 * * *' },
  { schedulerName: 'trial-manager', targetAgent: 'trial-manager', cadenceKind: 'cron', cronExpr: '0 16 * * *' },
  { schedulerName: 'billing-dunning', targetAgent: 'billing-dunning', cadenceKind: 'cron', cronExpr: '0 17 * * *' },
  { schedulerName: 'churn-recovery', targetAgent: 'churn-recovery', cadenceKind: 'cron', cronExpr: '30 17 * * *' },
  { schedulerName: 'portfolio-analyst', targetAgent: 'portfolio-analyst', cadenceKind: 'cron', cronExpr: '0 18 * * *' },
  // Niche calibration feedback loop (Phase 2): calibrator Monday, suggester
  // Tuesday (a day later so a full week of fresh snapshots exists to pool).
  { schedulerName: 'niche-calibrator', targetAgent: 'niche-calibrator', cadenceKind: 'cron', cronExpr: '0 9 * * 1' },
  { schedulerName: 'niche-prior-suggester', targetAgent: 'niche-prior-suggester', cadenceKind: 'cron', cronExpr: '0 9 * * 2' },
  { schedulerName: 'network-metrics-aggregator', targetAgent: 'network-metrics-aggregator', cadenceKind: 'cron', cronExpr: '0 4 * * *' },
  // network-link-requests seeds network-linker runs (siteId-mode) on a daily
  // off-peak slot; per-site weekly day-of-week staggering happens in-scheduler.
  { schedulerName: 'network-link-requests', targetAgent: 'network-linker', cadenceKind: 'cron', cronExpr: '0 5 * * *' },
  { schedulerName: 'geo-aeo-auditor', targetAgent: 'geo-aeo-auditor', cadenceKind: 'cron', cronExpr: '0 6 * * 1' },
  { schedulerName: 'local-seo-optimizer', targetAgent: 'local-seo-optimizer', cadenceKind: 'cron', cronExpr: '0 6 * * 2' },
  // fleet-digest (orchestrator Phase 5): 0 13 * * * UTC ~= 6am MST. Avoids the
  // 14:00 molly-digest slot. Not in vercel.json — DB-driven from the start.
  { schedulerName: 'fleet-digest', targetAgent: 'fleet-digest', cadenceKind: 'cron', cronExpr: '0 13 * * *' },
  // citation-runner (citations v1): weekly Monday 13:00 UTC ~= 6am MST, live sites only.
  { schedulerName: 'citation-runner', targetAgent: 'citation-runner', cadenceKind: 'cron', cronExpr: '0 13 * * 1' },
  // niche-keyword-refresher: quarterly cluster-cache warm, 05:00 UTC on the
  // 1st of Jan/Apr/Jul/Oct (cron.ts expands */3 to months 1,4,7,10).
  { schedulerName: 'niche-keyword-refresher', targetAgent: 'niche-keyword-refresher', cadenceKind: 'cron', cronExpr: '0 5 1 */3 *' },

  // Registered scheduler with no current timer — event/manual today. Parity.
  { schedulerName: 'wave-progression', targetAgent: 'wave-launcher', cadenceKind: 'manual' },
];

async function main() {
  // Honesty check against the live scheduler registry: warn about any scheduler
  // we forgot to seed, and refuse seed keys that aren't real schedulers.
  const registryKeys = new Set(Object.keys(schedulers));
  const seedKeys = new Set(SEED.map((s) => s.schedulerName));
  const unknown = [...seedKeys].filter((k) => !registryKeys.has(k));
  if (unknown.length > 0) {
    throw new Error(`seed references non-scheduler keys: ${unknown.join(', ')}`);
  }
  const uncovered = [...registryKeys].filter((k) => !seedKeys.has(k));
  if (uncovered.length > 0) {
    console.warn(`WARNING: schedulers not covered by this seed: ${uncovered.join(', ')}`);
  }

  const db = getDb();
  for (const row of SEED) {
    await db
      .insert(agentSchedules)
      .values({
        schedulerName: row.schedulerName,
        targetAgent: row.targetAgent,
        cadenceKind: row.cadenceKind,
        cronExpr: row.cronExpr ?? null,
        intervalMinutes: row.intervalMinutes ?? null,
        managedBy: 'human',
      })
      .onConflictDoUpdate({
        target: agentSchedules.schedulerName,
        set: {
          // Update the cadence DEFINITION; preserve runtime state
          // (last_enqueued_at, paused) so a re-seed never clobbers an
          // orchestrator-applied pause or the dedupe anchor.
          targetAgent: row.targetAgent,
          cadenceKind: row.cadenceKind,
          cronExpr: row.cronExpr ?? null,
          intervalMinutes: row.intervalMinutes ?? null,
          managedBy: 'human',
          updatedAt: new Date(),
        },
      });
  }

  const rows = await db.select().from(agentSchedules);
  console.log(`Seeded ${SEED.length} schedules. agent_schedules now has ${rows.length} rows:`);
  for (const r of rows.sort((a, b) => a.schedulerName.localeCompare(b.schedulerName))) {
    const cadence = r.cadenceKind === 'cron' ? r.cronExpr : r.cadenceKind === 'poll' ? `${r.intervalMinutes}m` : r.cadenceKind;
    console.log(`  ${r.schedulerName.padEnd(28)} ${String(cadence).padEnd(14)} -> ${r.targetAgent}${r.paused ? ' [paused]' : ''}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
