import { eq } from 'drizzle-orm';
import { getDb, buildsellSites } from '@leadlandlord/db';
import { klaviyo } from '@leadlandlord/integrations';
import type { Logger } from '@leadlandlord/shared/log';

/**
 * Idempotently ensure a Klaviyo list exists for this Build & Sell site and
 * the row's `klaviyoListId` is set. Returns the list ID, or undefined when
 * Klaviyo isn't configured or list creation failed (non-fatal — sites without
 * a list ID just skip the subscribe step in /api/bs/lead).
 *
 * Mirrors the R&R equivalent (site-builder/index.ts:ensureKlaviyoList).
 * Shared between the spec-site-builder build path and the operator's manual
 * "retry" action so both use identical idempotent-check/list-name logic.
 */
export async function ensureKlaviyoListForBuildSell(
  siteId: string,
  businessName: string,
  city: string,
  state: string,
  log: Logger,
): Promise<string | undefined> {
  if (!process.env.KLAVIYO_PRIVATE_API_KEY) {
    log.info('klaviyo: KLAVIYO_PRIVATE_API_KEY not set — skipping list creation');
    return undefined;
  }
  const db = getDb();
  const row = (
    await db
      .select({ klaviyoListId: buildsellSites.klaviyoListId })
      .from(buildsellSites)
      .where(eq(buildsellSites.id, siteId))
      .limit(1)
  )[0];
  if (row?.klaviyoListId) {
    log.info({ listId: row.klaviyoListId }, 'klaviyo: list already provisioned');
    return row.klaviyoListId;
  }
  try {
    const listName = `B&S · ${businessName} (${city}, ${state})`;
    const { listId } = await klaviyo.createList(listName);
    await db.update(buildsellSites).set({ klaviyoListId: listId }).where(eq(buildsellSites.id, siteId));
    log.info({ listId, listName }, 'klaviyo: list created');
    return listId;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : err },
      'klaviyo: list creation failed — proceeding without it',
    );
    return undefined;
  }
}
