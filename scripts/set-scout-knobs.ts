import { config } from 'dotenv';
config({ path: '.env.local' });
import { eq } from 'drizzle-orm';
import { getDb, systemState, getSystemState } from '@leadlandlord/db';

/**
 * Set niche-scout tuning knobs on the single system_state row.
 *
 * Usage:
 *   pnpm tsx scripts/set-scout-knobs.ts                 # print current scout knobs
 *   pnpm tsx scripts/set-scout-knobs.ts --measure-volume=true
 *   pnpm tsx scripts/set-scout-knobs.ts --pop-band-share=0.40
 *   pnpm tsx scripts/set-scout-knobs.ts --measure-volume=true --pop-band-share=0.40
 *   pnpm tsx scripts/set-scout-knobs.ts --agg-weight=65 --local-pack-boost=25
 *   pnpm tsx scripts/set-scout-knobs.ts --benchmark-winnability=0.45
 *
 * NULL/unset knobs fall back to the code defaults in
 * packages/agents/src/niche-hunter/scoring-config.ts (and, for the SERP
 * difficulty weights, packages/integrations/src/dataforseo/index.ts:
 * AGGREGATOR_WEIGHT 70 / LOCAL_PACK_BOOST 30). Pass a knob to override.
 */

const GLOBAL_ID = 'global';

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

async function main() {
  const measureVolume = arg('measure-volume');
  const popBandShare = arg('pop-band-share');
  const aggWeight = arg('agg-weight');
  const localPackBoost = arg('local-pack-boost');
  const benchmarkWinnability = arg('benchmark-winnability');

  const current = await getSystemState();
  console.log('Current scout knobs:');
  console.log(
    JSON.stringify(
      {
        scoutRefineMeasureVolume: current.scoutRefineMeasureVolume,
        scoutMaxPopBandShare: current.scoutMaxPopBandShare,
        scoutMaxPerTrade: current.scoutMaxPerTrade,
        scoutMaxCategoryShare: current.scoutMaxCategoryShare,
        scoutPerStateCap: current.scoutPerStateCap,
        scoutAggWeight: current.scoutAggWeight,
        scoutLocalPackBoost: current.scoutLocalPackBoost,
        scoutDefaultBenchmarkWinnability: current.scoutDefaultBenchmarkWinnability,
      },
      null,
      2,
    ),
  );

  const patch: Record<string, unknown> = {};
  if (measureVolume !== undefined) {
    patch.scoutRefineMeasureVolume = measureVolume === 'true';
  }
  if (popBandShare !== undefined) {
    // numeric columns are written as strings by drizzle-orm.
    patch.scoutMaxPopBandShare = String(parseFloat(popBandShare));
  }
  if (aggWeight !== undefined) {
    patch.scoutAggWeight = String(parseFloat(aggWeight));
  }
  if (localPackBoost !== undefined) {
    patch.scoutLocalPackBoost = String(parseFloat(localPackBoost));
  }
  if (benchmarkWinnability !== undefined) {
    patch.scoutDefaultBenchmarkWinnability = String(parseFloat(benchmarkWinnability));
  }

  if (Object.keys(patch).length === 0) {
    console.log(
      '\nNo changes requested (pass --measure-volume / --pop-band-share / --agg-weight / --local-pack-boost / --benchmark-winnability to set).',
    );
    return;
  }

  patch.updatedAt = new Date();
  const db = getDb();
  const [row] = await db
    .update(systemState)
    .set(patch)
    .where(eq(systemState.id, GLOBAL_ID))
    .returning();

  console.log('\nUpdated scout knobs:');
  console.log(
    JSON.stringify(
      {
        scoutRefineMeasureVolume: row.scoutRefineMeasureVolume,
        scoutMaxPopBandShare: row.scoutMaxPopBandShare,
        scoutAggWeight: row.scoutAggWeight,
        scoutLocalPackBoost: row.scoutLocalPackBoost,
        scoutDefaultBenchmarkWinnability: row.scoutDefaultBenchmarkWinnability,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
