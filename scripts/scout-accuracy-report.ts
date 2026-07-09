#!/usr/bin/env -S tsx
/**
 * Scout-accuracy report (ADR 0030 Phase 4, S6) — read-only calibration
 * evidence for the niche scout/validate engine. SELECT-only by construction —
 * connects via READONLY_DATABASE_URL when present (a read-only Neon role),
 * falls back to DATABASE_URL, and exits with `NO_DB` / code 2 when neither is
 * set (same contract as scripts/fleet-metrics.ts).
 *
 * Sections:
 *   a) Scout-vs-validate: does scout rank order predict validated value?
 *   b) Proxy-vs-measured: how biased are the Stage-1 proxies vs Stage-3
 *      local-SERP measurements?
 *   c) SERP-features-vs-outcomes: the S3c evidence gate — outcome deltas by
 *      local-pack presence and aggregator-share tercile. Do NOT re-weight the
 *      aggregator sign without this evidence.
 *
 * Usage:
 *   pnpm exec tsx scripts/scout-accuracy-report.ts
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function findEnv(start: string, name: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const c = resolve(dir, name);
    if (existsSync(c)) return c;
    const p = resolve(dir, '..');
    if (p === dir) return undefined;
    dir = p;
  }
}
const envLocal = findEnv(__dirname, '.env.local');
if (envLocal) loadEnv({ path: envLocal, override: true });

import { sql } from 'drizzle-orm';
import { getDb } from '@leadlandlord/db';
import {
  spearmanRankCorrelation,
  summarizeBias,
} from '@leadlandlord/agents/niche-hunter/accuracy-stats';

const dbUrl = process.env.READONLY_DATABASE_URL ?? process.env.DATABASE_URL;
if (!dbUrl) {
  console.error(
    'NO_DB: set READONLY_DATABASE_URL (preferred, read-only role) or DATABASE_URL for the scout-accuracy report.'
  );
  process.exit(2);
}
const db = getDb(dbUrl);

const fmt = (x: number | null | undefined, dp = 4): string =>
  x == null || !Number.isFinite(x) ? 'n/a' : x.toFixed(dp);

function meanOf(xs: Array<number | null>): { mean: number | null; n: number } {
  const vals = xs.filter((x): x is number => x != null && Number.isFinite(x));
  if (vals.length === 0) return { mean: null, n: 0 };
  return { mean: vals.reduce((s, x) => s + x, 0) / vals.length, n: vals.length };
}

// ── a) Scout-vs-validate ────────────────────────────────────────────────────

interface ValidatedRow {
  run_id: string;
  trade: string;
  rank: number;
  est: number;
  validated: number;
}

async function scoutVsValidate() {
  console.log('\n== a) Scout-vs-validate (candidate rank vs validated value) ==');
  const res = await db.execute(sql`
    SELECT c.scout_run_id::text AS run_id, c.trade, c.rank,
           c.est_monthly_value_usd::float8 AS est,
           c.validated_value_usd::float8 AS validated
    FROM niche_candidates c
    JOIN niche_scout_runs r ON r.id = c.scout_run_id
    WHERE c.status = 'validated' AND c.validated_value_usd IS NOT NULL
    ORDER BY c.scout_run_id, c.rank
  `);
  const rows = res.rows as unknown as ValidatedRow[];
  if (rows.length === 0) {
    console.log('insufficient data (no validated candidates yet)');
    return;
  }
  console.log(`validated candidates: ${rows.length}`);

  // Spearman between candidate rank (a) and validated-value DESC-rank (b):
  // spearman only consumes ranks, so b = -validated yields the DESC-rank
  // directly. A perfectly predictive scout scores +1.
  const byRun = new Map<string, ValidatedRow[]>();
  for (const row of rows) {
    const list = byRun.get(row.run_id) ?? [];
    list.push(row);
    byRun.set(row.run_id, list);
  }
  let printedRuns = 0;
  for (const [runId, runRows] of byRun) {
    if (runRows.length < 5) continue; // too few validated candidates to rank-correlate
    const rho = spearmanRankCorrelation(
      runRows.map((r) => ({ a: r.rank, b: -r.validated })),
    );
    console.log(`  run ${runId}: n=${runRows.length} spearman(rank vs validated desc-rank)=${fmt(rho)}`);
    printedRuns++;
  }
  if (printedRuns === 0) console.log('  per-run: insufficient data (no run has >= 5 validated candidates)');
  const pooled = spearmanRankCorrelation(rows.map((r) => ({ a: r.rank, b: -r.validated })));
  console.log(`  pooled (all runs): n=${rows.length} spearman=${fmt(pooled)}`);

  // Bias ratios est/validated, per trade (>= 3 samples) + overall + MAPE.
  const withActual = rows.filter((r) => r.validated > 0);
  const byTrade = new Map<string, number[]>();
  for (const r of withActual) {
    const list = byTrade.get(r.trade) ?? [];
    list.push(r.est / r.validated);
    byTrade.set(r.trade, list);
  }
  console.log('  bias ratio est_monthly_value_usd / validated_value_usd (1.0 = calibrated):');
  let printedTrades = 0;
  for (const [trade, ratios] of [...byTrade.entries()].sort((x, y) => y[1].length - x[1].length)) {
    if (ratios.length < 3) continue;
    const b = summarizeBias(ratios)!;
    console.log(`    ${trade}: n=${b.n} median=${fmt(b.median)} mean=${fmt(b.mean)}`);
    printedTrades++;
  }
  if (printedTrades === 0) console.log('    per-trade: insufficient data (no trade has >= 3 samples)');
  const overall = summarizeBias(withActual.map((r) => r.est / r.validated));
  if (overall) {
    const mape =
      withActual.reduce((s, r) => s + Math.abs(r.est - r.validated) / r.validated, 0) /
      withActual.length;
    console.log(
      `    overall: n=${overall.n} median=${fmt(overall.median)} mean=${fmt(overall.mean)} MAPE=${fmt(mape)}`,
    );
  } else {
    console.log('    overall: insufficient data (no validated values > 0)');
  }
}

// ── b) Proxy-vs-measured ────────────────────────────────────────────────────

async function proxyVsMeasured() {
  console.log('\n== b) Proxy-vs-measured (Stage-1 proxies vs Stage-3 local-SERP refinement) ==');
  const res = await db.execute(sql`
    SELECT cluster_difficulty::float8 AS cluster_difficulty,
           local_serp_difficulty::float8 AS local_serp_difficulty,
           proxy_est_monthly_value_usd::float8 AS proxy_est,
           est_monthly_value_usd::float8 AS est
    FROM niche_candidates
    WHERE refinement_source = 'local_serp'
  `);
  const rows = res.rows as unknown as Array<{
    cluster_difficulty: number | null;
    local_serp_difficulty: number | null;
    proxy_est: number | null;
    est: number;
  }>;
  if (rows.length === 0) {
    console.log('insufficient data (no refined candidates yet)');
    return;
  }
  console.log(`refined candidates: ${rows.length}`);

  const difficultyPairs = rows
    .filter((r) => r.cluster_difficulty != null && r.local_serp_difficulty != null)
    .map((r) => ({ a: r.cluster_difficulty!, b: r.local_serp_difficulty! }));
  const rho = spearmanRankCorrelation(difficultyPairs);
  console.log(
    `  spearman(cluster_difficulty vs local_serp_difficulty): n=${difficultyPairs.length} rho=${fmt(rho)}`,
  );

  const valueRatios = rows
    .filter((r) => r.proxy_est != null && r.est > 0)
    .map((r) => r.proxy_est! / r.est);
  const bias = summarizeBias(valueRatios);
  if (bias) {
    console.log(
      `  bias proxy_est_monthly_value_usd / est_monthly_value_usd: n=${bias.n} median=${fmt(bias.median)} mean=${fmt(bias.mean)}`,
    );
  } else {
    console.log('  value bias: insufficient data (no proxy snapshots yet)');
  }
}

// ── c) SERP-features-vs-outcomes (S3c evidence gate) ────────────────────────

interface OutcomeRow {
  has_local_pack: boolean | null;
  aggregator_share: number | null;
  money_kw_position: number | null;
  observed_ctr: number | null;
}

function printBucket(label: string, rows: OutcomeRow[]) {
  const pos = meanOf(rows.map((r) => r.money_kw_position));
  const ctr = meanOf(rows.map((r) => r.observed_ctr));
  console.log(
    `    ${label}: snapshots=${rows.length} mean_money_kw_position=${fmt(pos.mean, 2)} (n=${pos.n}) mean_observed_ctr=${fmt(ctr.mean)} (n=${ctr.n})`,
  );
}

async function serpFeaturesVsOutcomes() {
  console.log('\n== c) SERP-features-vs-outcomes ==');
  console.log(
    '  evidence gate for any aggregator-sign re-weighting (ADR 0030) — do not re-weight without this',
  );
  const res = await db.execute(sql`
    SELECT (n.dfs_raw -> 'serpComposition' ->> 'has_local_pack')::boolean AS has_local_pack,
           (n.dfs_raw -> 'serpComposition' ->> 'aggregator_share')::float8 AS aggregator_share,
           s.money_kw_position::float8 AS money_kw_position,
           s.observed_ctr::float8 AS observed_ctr
    FROM niches n
    JOIN sites st ON st.niche_id = n.id
    JOIN niche_outcome_snapshots s ON s.site_id = st.id
    WHERE (n.dfs_raw -> 'serpComposition') IS NOT NULL
  `);
  const rows = res.rows as unknown as OutcomeRow[];
  if (rows.length === 0) {
    console.log('insufficient data (no outcome snapshots joined to a SERP composition yet)');
    return;
  }
  console.log(`  outcome snapshots with SERP composition: ${rows.length}`);

  console.log('  by has_local_pack:');
  const withPack = rows.filter((r) => r.has_local_pack === true);
  const withoutPack = rows.filter((r) => r.has_local_pack === false);
  if (withPack.length === 0 && withoutPack.length === 0) {
    console.log('    insufficient data');
  } else {
    printBucket('local_pack=true', withPack);
    printBucket('local_pack=false', withoutPack);
  }

  console.log('  by aggregator_share tercile:');
  const withShare = rows.filter((r) => r.aggregator_share != null);
  if (withShare.length < 3) {
    console.log('    insufficient data');
    return;
  }
  const shares = withShare.map((r) => r.aggregator_share!).sort((a, b) => a - b);
  const t1 = shares[Math.floor(shares.length / 3)]!;
  const t2 = shares[Math.floor((2 * shares.length) / 3)]!;
  printBucket(
    `low (< ${t1.toFixed(3)})`,
    withShare.filter((r) => r.aggregator_share! < t1),
  );
  printBucket(
    `mid (${t1.toFixed(3)}..${t2.toFixed(3)})`,
    withShare.filter((r) => r.aggregator_share! >= t1 && r.aggregator_share! < t2),
  );
  printBucket(
    `high (>= ${t2.toFixed(3)})`,
    withShare.filter((r) => r.aggregator_share! >= t2),
  );
}

async function main() {
  console.log('Scout-accuracy report (ADR 0030 Phase 4) — read-only');
  await scoutVsValidate();
  await proxyVsMeasured();
  await serpFeaturesVsOutcomes();
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('scout-accuracy-report failed:', e?.message ?? e);
    process.exit(1);
  }
);
