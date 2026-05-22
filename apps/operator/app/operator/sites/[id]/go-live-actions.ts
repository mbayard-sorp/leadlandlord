'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, sites, agentEvents } from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';

export interface GoLiveManualFlags {
  gscSubmittedAt: string | null;
  gbpClaimedAt: string | null;
}

interface SiteMetadata {
  goLive?: GoLiveManualFlags;
  [key: string]: unknown;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Toggle a manual go-live checklist item. State lives in `sites.metadata.goLive`
 * as ISO timestamps (truthy = checked, null = unchecked) so we get a free
 * "checked at" history without a schema migration.
 */
export async function setGoLiveFlag(
  siteId: string,
  key: 'gscSubmittedAt' | 'gbpClaimedAt',
  checked: boolean,
): Promise<ActionResult> {
  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };

  const meta = (site.metadata as SiteMetadata | null) ?? {};
  const goLive: GoLiveManualFlags = meta.goLive ?? { gscSubmittedAt: null, gbpClaimedAt: null };
  goLive[key] = checked ? new Date().toISOString() : null;

  await db
    .update(sites)
    .set({ metadata: { ...meta, goLive }, updatedAt: new Date() })
    .where(eq(sites.id, siteId));

  log.info({ siteId, key, checked }, 'go-live flag updated');
  revalidatePath(`/operator/sites/${siteId}`);
  return { ok: true };
}

/**
 * Flip `sites.status` to `live`. The checklist gates the button — by the time
 * the operator can click it, all auto + manual items are satisfied. No further
 * validation here; the UI is the contract.
 */
export async function promoteSiteToLive(siteId: string): Promise<ActionResult> {
  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };
  if (site.status === 'live') return { ok: true, message: 'already live' };

  await db
    .update(sites)
    .set({ status: 'live', updatedAt: new Date() })
    .where(eq(sites.id, siteId));

  // Now indexable (the go-live checklist already required robotsDisallow=false).
  // Kick the IndexNow submitter so Bing + Brave crawl the freshly-live URLs —
  // this is what lets the site surface in ChatGPT/Claude search. Auto-dispatched
  // (no approval gate): the operator's go-live click is the authorizing action.
  await db.insert(agentEvents).values({
    agent: 'operator',
    type: 'site.activated',
    targetAgent: 'indexnow-submitter',
    payload: { site_id: siteId },
  });

  log.info({ siteId, prevStatus: site.status }, 'site promoted to live');
  revalidatePath(`/operator/sites/${siteId}`);
  return { ok: true };
}

