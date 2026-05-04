import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { BaseAgent, type AgentContext } from '../base';
import { getDb, sites, prospects, type NewProspect } from '@leadlandlord/db';
import { searchN, type Place } from '@leadlandlord/integrations/google-places';
import { IntegrationError } from '@leadlandlord/shared/errors';

export const TenantProspectorInput = z.object({
  site_id: z.string().uuid(),
  count: z.number().int().positive().max(200).default(50),
  /** When true, skip businesses we've already seen for this site. */
  exclude_existing: z.boolean().default(true),
  /** Custom search query — defaults to "<niche> in <city>, <state>" derived from the site. */
  query_override: z.string().optional(),
});
export type TenantProspectorInput = z.infer<typeof TenantProspectorInput>;

export const TenantProspectorOutput = z.object({
  site_id: z.string().uuid(),
  found: z.number().int().nonnegative(),
  inserted: z.number().int().nonnegative(),
  skipped_duplicates: z.number().int().nonnegative(),
  skipped_no_phone: z.number().int().nonnegative(),
  skipped_self: z.number().int().nonnegative(),
});
export type TenantProspectorOutput = z.infer<typeof TenantProspectorOutput>;

/**
 * Find local businesses to prospect as tenants for this site.
 *
 * Pipeline:
 *   1. Look up site (niche, city, state, tracking_number)
 *   2. Query Google Places Text Search — "<niche> in <city>, <state>"
 *   3. Filter out the site's own tracking number (we'd be prospecting ourselves)
 *      and any businesses already in the prospects table for this site
 *   4. Insert each survivor as a `prospects` row with status='new'
 *
 * Phase 7 will add website scraping for owner email + Hunter.io fallback.
 * Today's MVP gets us business_name, phone, website, address — enough for
 * Outreach Agent to start with SMS-first sequences.
 */
export class TenantProspector extends BaseAgent<typeof TenantProspectorInput, typeof TenantProspectorOutput> {
  constructor() {
    super({
      name: 'tenant-prospector',
      inputSchema: TenantProspectorInput,
      outputSchema: TenantProspectorOutput,
      // Same site shouldn't be prospected twice in the same minute window —
      // dedupe by site_id and the truncated timestamp.
      dedupeKeyFn: (i) => `${i.site_id}:${Math.floor(Date.now() / 60_000)}`,
      defaultDailyCapUsd: 5,
    });
  }

  protected async execute(
    input: TenantProspectorInput,
    ctx: AgentContext,
  ): Promise<TenantProspectorOutput> {
    const db = getDb();

    // 1. Load site context.
    const site = (await db.select().from(sites).where(eq(sites.id, input.site_id)).limit(1))[0];
    if (!site) {
      throw new IntegrationError('tenant-prospector', `site ${input.site_id} not found`);
    }

    const query =
      input.query_override ?? `${site.niche} in ${site.city}, ${site.state}`;
    ctx.log.info({ siteId: input.site_id, query }, 'tenant-prospector starting search');

    // 2. Search Google Places.
    const places = await searchN(query, input.count, { excludeClosed: true });
    ctx.log.info({ count: places.length }, 'google-places returned');

    // 3. Pre-load existing prospect phone numbers for this site so we can dedupe.
    const existingRows = input.exclude_existing
      ? await db
          .select({ phone: prospects.phone, businessName: prospects.businessName })
          .from(prospects)
          .where(eq(prospects.siteId, input.site_id))
      : [];
    const existingPhones = new Set(
      existingRows
        .map((r) => normalizePhone(r.phone))
        .filter((p): p is string => p !== null),
    );
    const existingNames = new Set(existingRows.map((r) => r.businessName.toLowerCase().trim()));

    const trackingNumber = normalizePhone(site.trackingNumber);

    let inserted = 0;
    let skippedDuplicates = 0;
    let skippedNoPhone = 0;
    let skippedSelf = 0;

    const toInsert: NewProspect[] = [];
    for (const place of places) {
      const phoneRaw = place.nationalPhoneNumber ?? place.internationalPhoneNumber;
      const phone = normalizePhone(phoneRaw);
      if (!phone) {
        skippedNoPhone++;
        continue;
      }
      if (trackingNumber && phone === trackingNumber) {
        skippedSelf++;
        continue;
      }
      const name = place.displayName?.text?.trim();
      if (!name) {
        skippedNoPhone++;
        continue;
      }
      if (existingPhones.has(phone) || existingNames.has(name.toLowerCase())) {
        skippedDuplicates++;
        continue;
      }
      // Track within this run too so we don't insert duplicates from the same batch.
      existingPhones.add(phone);
      existingNames.add(name.toLowerCase());

      toInsert.push({
        siteId: input.site_id,
        businessName: name,
        phone,
        websiteUrl: place.websiteUri ?? null,
        source: 'google-places',
        status: 'new',
        metadata: buildMetadata(place),
      });
    }

    if (toInsert.length > 0) {
      const insertedRows = await db.insert(prospects).values(toInsert).returning({ id: prospects.id });
      inserted = insertedRows.length;
    }

    ctx.log.info(
      {
        siteId: input.site_id,
        found: places.length,
        inserted,
        skippedDuplicates,
        skippedNoPhone,
        skippedSelf,
      },
      'tenant-prospector finished',
    );

    return {
      site_id: input.site_id,
      found: places.length,
      inserted,
      skipped_duplicates: skippedDuplicates,
      skipped_no_phone: skippedNoPhone,
      skipped_self: skippedSelf,
    };
  }
}

function buildMetadata(place: Place): Record<string, unknown> {
  return {
    google_place_id: place.id,
    address: place.formattedAddress,
    primary_type: place.primaryType,
    rating: place.rating,
    user_rating_count: place.userRatingCount,
    location: place.location,
  };
}

/**
 * Normalize phone to E.164 (or as close as we can get with US defaults).
 * Returns null when the input is missing or has fewer than 10 digits.
 */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^+\d]/g, '');
  if (digits.startsWith('+') && digits.length >= 11) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length < 10) return null;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

// Suppress unused warning — the SQL helper is reserved for future bulk-dedupe
// queries when prospect counts get into the thousands per site.
void sql;
