import { eq } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';

/**
 * Resolve the tracking number for a site from Postgres. Phase B: per-request
 * Postgres lookup. ISR caching with cacheTag('site:tracking:<id>') is Track C
 * — falls under the same cacheComponents tradeoff as lib/sanity.ts.
 *
 * Falls back to '+1-555-0100' when no number is provisioned (dev / placeholder).
 */
export async function getTrackingNumber(siteId: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ n: sites.trackingNumber })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);
  return rows[0]?.n ?? '+1-555-0100';
}
