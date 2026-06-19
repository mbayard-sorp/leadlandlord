import { sql, and, gt, inArray } from 'drizzle-orm';
import { getDb, type Db } from './client';
import { buildsellLeads, type NewBuildsellLead } from './schema';

/**
 * Build & Sell DB helpers — the 30-day Places cache + ToS reaper.
 *
 * The `buildsell_leads` table doubles as the cache: a row is "fresh" while
 * `cached_until > now()`. Repeat searches serve fresh rows; only stale/missing
 * places hit the Places API. `reapExpiredBuildSellPii` nulls all PII once a
 * row passes `cached_until`, keeping only `place_id`/`trade`/`city`/`state`.
 */

/** 30 days, the ToS-mandated cache lifetime for Places PII. */
export const BUILDSELL_CACHE_DAYS = 30;

/**
 * Upsert searched places into the cache. On place_id conflict, refresh all
 * cache fields and push `cached_until` out another 30 days.
 */
export async function upsertBuildsellLeads(
  rows: NewBuildsellLead[],
  db: Db = getDb(),
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(buildsellLeads)
    .values(rows)
    .onConflictDoUpdate({
      target: buildsellLeads.placeId,
      set: {
        displayName: sql`excluded.display_name`,
        formattedAddress: sql`excluded.formatted_address`,
        nationalPhone: sql`excluded.national_phone`,
        primaryType: sql`excluded.primary_type`,
        types: sql`excluded.types`,
        rating: sql`excluded.rating`,
        userRatingCount: sql`excluded.user_rating_count`,
        websiteUri: sql`excluded.website_uri`,
        lat: sql`excluded.lat`,
        lng: sql`excluded.lng`,
        trade: sql`excluded.trade`,
        city: sql`excluded.city`,
        state: sql`excluded.state`,
        cachedUntil: sql`excluded.cached_until`,
        updatedAt: sql`now()`,
      },
    });
}

/** Return cached rows for the given place_ids that are still fresh (not past cached_until). */
export async function fetchFreshBuildsellLeads(
  placeIds: string[],
  db: Db = getDb(),
) {
  if (placeIds.length === 0) return [];
  return db
    .select()
    .from(buildsellLeads)
    .where(and(inArray(buildsellLeads.placeId, placeIds), gt(buildsellLeads.cachedUntil, sql`now()`)));
}

/**
 * ToS PII-deletion guarantee. Nulls every cache column on rows past their
 * `cached_until`, keeping only `place_id`/`trade`/`city`/`state` (and the
 * timestamps). Idempotent: only touches rows that still have PII. Returns
 * the number of rows reaped.
 *
 * Called every operator tick (no separate cron).
 */
export async function reapExpiredBuildSellPii(db: Db = getDb()): Promise<number> {
  const result = await db
    .update(buildsellLeads)
    .set({
      displayName: null,
      formattedAddress: null,
      nationalPhone: null,
      primaryType: null,
      types: null,
      rating: null,
      userRatingCount: null,
      websiteUri: null,
      lat: null,
      lng: null,
      updatedAt: sql`now()`,
    })
    .where(
      sql`${buildsellLeads.cachedUntil} < now() and ${buildsellLeads.displayName} is not null`,
    )
    .returning({ id: buildsellLeads.id });
  return result.length;
}
