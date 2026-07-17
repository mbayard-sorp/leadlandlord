import { eq } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import { getDb, sites } from '@leadlandlord/db';
import { formatPhone } from './content';

/**
 * Resolve the tracking number for a site from Postgres.
 *
 * Track C: the lookup is wrapped in unstable_cache (1h revalidate, tag
 * `site:tracking:<siteId>`) so page views hit the data cache instead of waking
 * the Neon compute. Bust early via POST /api/revalidate with that tag when a
 * number is provisioned or swapped.
 *
 * The DB stores E.164 (e.g. `+17252403261` from Twilio); callers want
 * human-formatted (`(725) 240-3261`) for display. Formatting happens outside
 * the cache so the cache stores the raw E.164 value.
 *
 * Falls back to '(555) 010-0100' when no number is provisioned (dev / placeholder).
 */
export async function getTrackingNumber(siteId: string): Promise<string> {
  const cached = unstable_cache(
    async (): Promise<string | null> => {
      const db = getDb();
      const rows = await db
        .select({ n: sites.trackingNumber })
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1);
      return rows[0]?.n ?? null;
    },
    ['site-tracking-number', siteId],
    { revalidate: 3600, tags: [`site:tracking:${siteId}`, 'db:sites'] },
  );
  const raw = (await cached()) ?? '+15550100100';
  return formatPhone(raw);
}
