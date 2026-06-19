import { sql, and, or, gt, inArray, isNotNull, eq, desc } from 'drizzle-orm';
import { getDb, type Db } from './client';
import { buildsellLeads, type NewBuildsellLead, type BuildsellLead } from './schema';

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

/**
 * Retention sweep for raw content-migration suggestions.
 *
 * The content-migrator stages a `metadata.pendingMigration` blob (crawled copy
 * + uploaded-image refs) for operator review. APPROVED content is copied into
 * the Sanity doc by applyMigrationSelections (durable there), so the blob is
 * disposable. This drops any pendingMigration blob older than `ttlDays`
 * regardless of status — honoring the "discard raw crawl output" guarantee.
 *
 * Uses the jsonb `-` operator to strip just that key, preserving the rest of
 * metadata (rating, regenCap, etc.). Idempotent. Returns the number of rows
 * swept. Called every operator tick (no separate cron).
 */
export async function sweepStalePendingMigrations(
  ttlDays = Number(process.env.MIGRATION_PENDING_TTL_DAYS ?? '14'),
  db: Db = getDb(),
): Promise<number> {
  const result = await db.execute(sql`
    UPDATE buildsell_sites
    SET metadata = metadata - 'pendingMigration', updated_at = now()
    WHERE metadata ? 'pendingMigration'
      AND (metadata->'pendingMigration'->>'createdAt') IS NOT NULL
      AND (metadata->'pendingMigration'->>'createdAt')::timestamptz
            < now() - make_interval(days => ${ttlDays})
  `);
  // drizzle's execute returns a result whose rowCount reflects affected rows.
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}

// ────────────────────────────────────────────────────────────
// Lead CRM (call tracking). Persisted LAZILY: a lead only lands in
// buildsell_leads the moment the operator first acts on it (mark Called /
// note / follow-up). `called`/`note`/`followUpAt` are operator-authored and
// are NOT nulled by the reaper — only the Places-sourced PII is.
// ────────────────────────────────────────────────────────────

/** Places snapshot captured from the transient search result when a lead is saved. */
export interface LeadSnapshot {
  displayName?: string | null;
  formattedAddress?: string | null;
  nationalPhone?: string | null;
  primaryType?: string | null;
  types?: unknown;
  rating?: number | null;
  userRatingCount?: number | null;
  websiteUri?: string | null;
  lat?: number | null;
  lng?: number | null;
  trade?: string | null;
  city?: string | null;
  state?: string | null;
}

/** Partial CRM change. Only the keys present are written (so marking Called keeps an existing note). */
export interface LeadCrmPatch {
  called?: boolean;
  calledAt?: Date | null;
  note?: string | null;
  followUpAt?: Date | null;
}

/**
 * Upsert a single lead's CRM patch, carrying a fresh Places snapshot.
 * On conflict: refresh the snapshot (COALESCE so an absent value never wipes an
 * existing one), extend `cached_until` 30 days, and apply ONLY the CRM keys in
 * `patch`. This is the lazy-persist entry point for the call-list UI.
 */
export async function upsertLeadCrm(
  placeId: string,
  snapshot: LeadSnapshot,
  patch: LeadCrmPatch,
  db: Db = getDb(),
): Promise<void> {
  const num = (v?: number | null, scale = 1) => (v == null ? null : v.toFixed(scale));
  const cachedUntil = new Date(Date.now() + BUILDSELL_CACHE_DAYS * 24 * 60 * 60 * 1000);

  const insertRow: NewBuildsellLead = {
    placeId,
    displayName: snapshot.displayName ?? null,
    formattedAddress: snapshot.formattedAddress ?? null,
    nationalPhone: snapshot.nationalPhone ?? null,
    primaryType: snapshot.primaryType ?? null,
    types: snapshot.types ?? null,
    rating: num(snapshot.rating, 1),
    userRatingCount: snapshot.userRatingCount ?? null,
    websiteUri: snapshot.websiteUri ?? null,
    lat: num(snapshot.lat, 7),
    lng: num(snapshot.lng, 7),
    trade: snapshot.trade ?? null,
    city: snapshot.city ?? null,
    state: snapshot.state ?? null,
    cachedUntil,
    called: patch.called ?? false,
    calledAt: patch.calledAt ?? null,
    note: patch.note ?? null,
    followUpAt: patch.followUpAt ?? null,
  };

  // Snapshot refresh uses COALESCE(excluded, existing) so a sparse re-save
  // (e.g. editing a note from the follow-up list after PII was reaped) never
  // clobbers what's there.
  const set: Record<string, unknown> = {
    displayName: sql`coalesce(excluded.display_name, ${buildsellLeads.displayName})`,
    formattedAddress: sql`coalesce(excluded.formatted_address, ${buildsellLeads.formattedAddress})`,
    nationalPhone: sql`coalesce(excluded.national_phone, ${buildsellLeads.nationalPhone})`,
    primaryType: sql`coalesce(excluded.primary_type, ${buildsellLeads.primaryType})`,
    types: sql`coalesce(excluded.types, ${buildsellLeads.types})`,
    rating: sql`coalesce(excluded.rating, ${buildsellLeads.rating})`,
    userRatingCount: sql`coalesce(excluded.user_rating_count, ${buildsellLeads.userRatingCount})`,
    websiteUri: sql`coalesce(excluded.website_uri, ${buildsellLeads.websiteUri})`,
    lat: sql`coalesce(excluded.lat, ${buildsellLeads.lat})`,
    lng: sql`coalesce(excluded.lng, ${buildsellLeads.lng})`,
    trade: sql`coalesce(excluded.trade, ${buildsellLeads.trade})`,
    city: sql`coalesce(excluded.city, ${buildsellLeads.city})`,
    state: sql`coalesce(excluded.state, ${buildsellLeads.state})`,
    cachedUntil: sql`excluded.cached_until`,
    updatedAt: sql`now()`,
  };
  if (patch.called !== undefined) set.called = patch.called;
  if (patch.calledAt !== undefined) set.calledAt = patch.calledAt;
  if (patch.note !== undefined) set.note = patch.note;
  if (patch.followUpAt !== undefined) set.followUpAt = patch.followUpAt;

  await db
    .insert(buildsellLeads)
    .values(insertRow)
    .onConflictDoUpdate({ target: buildsellLeads.placeId, set });
}

export interface LeadCrmOverlay {
  called: boolean;
  calledAt: Date | null;
  note: string | null;
  followUpAt: Date | null;
}

/** Map place_id → saved CRM state, for overlaying onto transient search results. */
export async function fetchLeadCrmByPlaceIds(
  placeIds: string[],
  db: Db = getDb(),
): Promise<Map<string, LeadCrmOverlay>> {
  const map = new Map<string, LeadCrmOverlay>();
  if (placeIds.length === 0) return map;
  const rows = await db
    .select({
      placeId: buildsellLeads.placeId,
      called: buildsellLeads.called,
      calledAt: buildsellLeads.calledAt,
      note: buildsellLeads.note,
      followUpAt: buildsellLeads.followUpAt,
    })
    .from(buildsellLeads)
    .where(inArray(buildsellLeads.placeId, placeIds));
  for (const r of rows) {
    map.set(r.placeId, {
      called: r.called,
      calledAt: r.calledAt,
      note: r.note,
      followUpAt: r.followUpAt,
    });
  }
  return map;
}

/**
 * Worked leads for the call/follow-up board: any lead that's been called, has a
 * note, or has a follow-up scheduled. Ordered by follow-up date (soonest first,
 * nulls last), then most-recently touched.
 */
export async function listWorkedLeads(
  db: Db = getDb(),
  limit = 200,
): Promise<BuildsellLead[]> {
  return db
    .select()
    .from(buildsellLeads)
    .where(
      or(
        eq(buildsellLeads.called, true),
        isNotNull(buildsellLeads.note),
        isNotNull(buildsellLeads.followUpAt),
      ),
    )
    .orderBy(sql`${buildsellLeads.followUpAt} asc nulls last`, desc(buildsellLeads.updatedAt))
    .limit(limit);
}
