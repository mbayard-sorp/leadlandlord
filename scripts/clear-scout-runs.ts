#!/usr/bin/env -S tsx
/**
 * Clear all scout results produced by the pre-ADR-0030 scorer.
 *
 * Deletes, in order:
 *   1. Every niche_scout_runs row — the ON DELETE CASCADE FK on
 *      niche_candidates.scout_run_id removes all candidates with them.
 *   2. Every niches row still at decision='pending' with no site attached —
 *      the approval-queue leftovers promoted from those old runs. Approved
 *      and rejected niches, and anything a site references, are NEVER touched.
 *
 * Why: every existing run was scored by the old formula (including cells
 * valued off cached fallback SERP compositions, ADR 0030 B1). Clearing them
 * also frees their trade+city combos to be re-scouted by the fixed engine —
 * the scout's existingCombos exclusion keys off `niches` rows, so a leftover
 * pending row would keep its combo out of every future grid. The old runs'
 * validated-candidate calibration history is deleted with them; it measured
 * the deprecated formula, not the current one.
 *
 * Dry-run by default — prints counts only. Pass --execute to DELETE.
 * Uses DATABASE_URL (writes) — never READONLY_DATABASE_URL.
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
const __dirname = dirname(fileURLToPath(import.meta.url));
function findEnv(s: string, n: string): string | undefined {
  let d = s;
  for (let i = 0; i < 8; i++) {
    const c = resolve(d, n);
    if (existsSync(c)) return c;
    const p = resolve(d, '..');
    if (p === d) return;
    d = p;
  }
}
const env = findEnv(__dirname, '.env.local');
if (env) loadEnv({ path: env, override: true });
import { sql } from 'drizzle-orm';
import { getDb } from '@leadlandlord/db';

const execute = process.argv.includes('--execute');
const db = getDb();

/** `WHERE` predicate for the pending-niche delete target — pending decision,
 *  and no site row references the niche (belt-and-suspenders: sites.niche_id
 *  is ON DELETE SET NULL anyway). */
const PENDING_TARGET = sql`
  decision = 'pending'
  AND id NOT IN (SELECT niche_id FROM sites WHERE niche_id IS NOT NULL)`;

async function main() {
  const runRows = await db.execute(sql`
    SELECT status, count(*)::int AS n FROM niche_scout_runs GROUP BY status ORDER BY status`);
  const runTotal = (runRows.rows as Array<{ status: string; n: number }>).reduce(
    (s, r) => s + r.n,
    0,
  );
  console.log(`Scout runs to delete: ${runTotal}`);
  for (const r of runRows.rows as Array<{ status: string; n: number }>) {
    console.log(`  ${r.status}: ${r.n}`);
  }

  const candRows = await db.execute(sql`
    SELECT status, count(*)::int AS n FROM niche_candidates GROUP BY status ORDER BY status`);
  const candTotal = (candRows.rows as Array<{ status: string; n: number }>).reduce(
    (s, r) => s + r.n,
    0,
  );
  console.log(`Candidates to delete (via run cascade): ${candTotal}`);
  for (const r of candRows.rows as Array<{ status: string; n: number }>) {
    console.log(`  ${r.status}: ${r.n}`);
  }

  const pending = await db.execute(sql`
    SELECT count(*)::int AS n FROM niches WHERE ${PENDING_TARGET}`);
  const pendingN = (pending.rows[0] as { n: number }).n;
  console.log(`Pending never-approved niches to delete (no site attached): ${pendingN}`);

  const kept = await db.execute(sql`
    SELECT decision, count(*)::int AS n FROM niches
    WHERE NOT (${PENDING_TARGET})
    GROUP BY decision ORDER BY decision`);
  console.log('Niches KEPT (approved/rejected/site-attached):');
  for (const r of kept.rows as Array<{ decision: string | null; n: number }>) {
    console.log(`  ${r.decision ?? 'null'}: ${r.n}`);
  }

  if (!execute) {
    console.log(
      '\nDry run — nothing deleted. Re-run with --execute to clear the rows above.\n' +
        'Cleared combos become re-scoutable by the fixed engine on the next scout run.',
    );
    return;
  }

  // neon-http has no transactions; ordering is the integrity mechanism. Runs
  // first (cascade removes candidates and their niche_id links), then the
  // orphaned pending approval-queue rows.
  const deletedRuns = await db.execute(sql`DELETE FROM niche_scout_runs`);
  console.log(`\nDeleted ${deletedRuns.rowCount ?? 0} scout runs (candidates cascade-deleted).`);

  const deletedNiches = await db.execute(sql`DELETE FROM niches WHERE ${PENDING_TARGET}`);
  console.log(`Deleted ${deletedNiches.rowCount ?? 0} pending niches.`);

  const remainingCands = await db.execute(sql`SELECT count(*)::int AS n FROM niche_candidates`);
  console.log(
    `Remaining candidates: ${(remainingCands.rows[0] as { n: number }).n} (expected 0).`,
  );
}

main().then(() => process.exit(0));
