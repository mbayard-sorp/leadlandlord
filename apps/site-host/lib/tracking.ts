import { eq } from 'drizzle-orm';
import { getDb, sites } from '@leadlandlord/db';
import { formatPhone } from './content';

/**
 * Resolve the tracking number for a site from Postgres. Phase B: per-request
 * Postgres lookup. ISR caching with cacheTag('site:tracking:<id>') is Track C
 * — falls under the same cacheComponents tradeoff as lib/sanity.ts.
 *
 * The DB stores E.164 (e.g. `+17252403261` from Twilio); callers want
 * human-formatted (`(725) 240-3261`) for display. Format on read so every
 * consumer renders the same way without each having to remember.
 *
 * Falls back to '(555) 010-0100' when no number is provisioned (dev / placeholder).
 */
export async function getTrackingNumber(siteId: string): Promise<string> {
  const db = getDb();
  const rows = await db
    .select({ n: sites.trackingNumber })
    .from(sites)
    .where(eq(sites.id, siteId))
    .limit(1);
  const raw = rows[0]?.n ?? '+15550100100';
  return formatPhone(raw);
}
