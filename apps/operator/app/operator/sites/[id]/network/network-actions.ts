'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, getDb, inArray, linkRequests, sites } from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';

export interface ActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Manually enqueue a network-linker run for a site. Inserts a pending
 * `link_requests` row which the `network-linker` drain scheduler picks up on the
 * next poll. Guarded against piling up: if a pending/processing request already
 * exists for the site, this is a no-op.
 */
export async function requestNetworkLinks(siteId: string): Promise<ActionResult> {
  const db = getDb();

  const site = (await db.select({ id: sites.id }).from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };

  const existing = (
    await db
      .select({ id: linkRequests.id })
      .from(linkRequests)
      .where(
        and(
          eq(linkRequests.requestingSiteId, siteId),
          inArray(linkRequests.status, ['pending', 'processing']),
        ),
      )
      .limit(1)
  )[0];

  if (existing) {
    return { ok: true, message: 'a link request is already queued for this site' };
  }

  await db.insert(linkRequests).values({
    requestingSiteId: siteId,
    desiredCount: 1,
    status: 'pending',
    scheduledFor: new Date(),
  });

  log.info({ siteId }, 'manual network link request enqueued');
  revalidatePath(`/operator/sites/${siteId}/network`);
  return { ok: true, message: 'link request queued' };
}
