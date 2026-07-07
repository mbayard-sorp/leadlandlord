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
 *
 * NULL/unset knobs fall back to the code defaults in
 * packages/agents/src/niche-hunter/scoring-config.ts. Pass a knob to override.
 */

const GLOBAL_ID = 'global';

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
}

async function main() {
  const measureVolume = arg('measure-volume');
  const popBandShare = arg('pop-band-share');

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

  if (Object.keys(patch).length === 0) {
    console.log('\nNo changes requested (pass --measure-volume / --pop-band-share to set).');
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
