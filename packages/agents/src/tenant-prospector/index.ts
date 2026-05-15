import { z } from 'zod';
import { eq, sql, and } from 'drizzle-orm';
import { BaseAgent, type AgentContext } from '../base';
import { getDb, sites, prospects, agentApprovals, type NewProspect } from '@leadlandlord/db';
import { searchN, type Place } from '@leadlandlord/integrations/google-places';
import { findOwnerByDomain } from '@leadlandlord/integrations/apollo';
import { getPaidAdCount } from '@leadlandlord/integrations/dataforseo';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { checkAutoApprove } from '../approval-engine';

/** Score threshold above which a prospect is eligible for trial promotion. */
const PROMOTE_TO_TRIAL_SCORE_THRESHOLD = 70;

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
  enriched: z.number().int().nonnegative(),
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
    const apolloEnabled = !!process.env.APOLLO_API_KEY;

    // Niche-level willingness-to-pay signal: how many advertisers are bidding
    // on this niche+city right now. One call per run (not per prospect) — the
    // signal applies to the whole local market. 0 on failure keeps scoring unblocked.
    const paidAdCount = await getPaidAdCount({ keyword: query }).catch(() => 0);
    ctx.log.info({ siteId: input.site_id, paidAdCount }, 'tenant-prospector paid-ad signal');

    let inserted = 0;
    let skippedDuplicates = 0;
    let skippedNoPhone = 0;
    let skippedSelf = 0;
    let enriched = 0;

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

      // Apollo enrichment — best-effort, never throws. Adds owner name +
      // email when Apollo has the org. Skipped entirely when no website,
      // when APOLLO_API_KEY isn't set, or when Apollo has no record.
      let contactName: string | null = null;
      let email: string | null = null;
      let apolloMetadata: Record<string, unknown> | undefined;
      let apolloOrgId: string | null = null;
      if (apolloEnabled && place.websiteUri) {
        const owner = await safeFindOwner(place.websiteUri, ctx);
        if (owner) {
          enriched++;
          const fullName =
            owner.person.name ??
            ([owner.person.first_name, owner.person.last_name].filter(Boolean).join(' ').trim() ||
              null);
          contactName = fullName || null;
          email = owner.person.email && !owner.person.email.includes('email_not_unlocked')
            ? owner.person.email
            : null;
          apolloOrgId = owner.org.id ?? null;
          apolloMetadata = {
            apollo_org_id: owner.org.id,
            apollo_person_id: owner.person.id,
            apollo_title: owner.person.title,
            apollo_email_status: owner.person.email_status,
            apollo_seniority: owner.person.seniority,
            apollo_linkedin: owner.person.linkedin_url,
            apollo_employees: owner.org.estimated_num_employees,
            apollo_industry: owner.org.industry,
          };
        }
      }

      const rating = typeof place.rating === 'number' ? place.rating : null;
      const reviewCount = typeof place.userRatingCount === 'number' ? place.userRatingCount : null;
      // Heuristic score 0-100. Weights:
      //   paid-ad density (0-30): proxy for niche advertiser willingness-to-pay
      //   review count (0-30): proxy for business activity/longevity
      //   rating (0-20): quality floor
      //   apollo enrichment hit (0-20): contact reachability
      const score =
        Math.min(paidAdCount, 10) * 3 +
        Math.min(reviewCount ?? 0, 300) / 10 +
        Math.max(0, ((rating ?? 0) - 3)) * 10 +
        (apolloOrgId ? 20 : 0);

      toInsert.push({
        siteId: input.site_id,
        businessName: name,
        contactName,
        phone,
        email,
        websiteUrl: place.websiteUri ?? null,
        source: 'google-places',
        status: 'new',
        metadata: { ...buildMetadata(place), ...(apolloMetadata ?? {}) },
        apolloOrgId,
        scoringMetadata: {
          score: Math.round(Math.min(score, 100)),
          paid_ad_count: paidAdCount,
          rating,
          review_count: reviewCount,
          has_apollo: !!apolloOrgId,
          scored_at: new Date().toISOString(),
        },
      });
    }

    if (toInsert.length > 0) {
      const insertedRows = await db.insert(prospects).values(toInsert).returning({ id: prospects.id });
      inserted = insertedRows.length;

      // ── Approval gate: prospect_promote_to_trial ───────────────────────────
      // For high-score prospects (score >= threshold), queue a
      // prospect_promote_to_trial approval so the operator can green-light
      // the handoff to TrialManager. Auto-approve rules apply (>= 70 auto-approves).
      // Idempotency: skip if a pending approval already exists for the
      // same (site_id, prospect row index combination keyed by business name).
      const highScoreCandidates = toInsert
        .map((p, i) => ({ prospect: p, id: insertedRows[i]?.id }))
        .filter(({ prospect }) => {
          const score =
            prospect.scoringMetadata !== null &&
            typeof prospect.scoringMetadata === 'object' &&
            'score' in (prospect.scoringMetadata as Record<string, unknown>)
              ? Number((prospect.scoringMetadata as Record<string, unknown>).score)
              : 0;
          return score >= PROMOTE_TO_TRIAL_SCORE_THRESHOLD;
        });

      for (const { prospect, id: prospectId } of highScoreCandidates) {
        if (!prospectId) continue;
        const score = Number(
          (prospect.scoringMetadata as Record<string, unknown>).score,
        );

        // Idempotency check per prospect.
        const existingPromoteApproval = await db
          .select({ id: agentApprovals.id })
          .from(agentApprovals)
          .where(
            and(
              eq(agentApprovals.kind, 'prospect_promote_to_trial'),
              sql`${agentApprovals.payload}->>'prospect_id' = ${prospectId}`,
              eq(agentApprovals.status, 'pending'),
            ),
          )
          .limit(1);

        if (existingPromoteApproval.length > 0) {
          ctx.log.info(
            { prospectId, approvalId: existingPromoteApproval[0]!.id },
            'prospect_promote_to_trial: pending approval already exists — skipping',
          );
          continue;
        }

        const promotePayload = {
          kind: 'prospect_promote_to_trial' as const,
          prospect_id: prospectId,
          site_id: input.site_id,
          business_name: prospect.businessName,
          prospect_score: score,
        };

        let promoteApprovalStatus = 'pending';
        let promoteRuleMatched: string | undefined;
        try {
          const autoResult = await checkAutoApprove('prospect_promote_to_trial', promotePayload, db);
          if (autoResult.matched) {
            promoteApprovalStatus = 'auto_approved';
            promoteRuleMatched = autoResult.ruleId;
          }
        } catch (err) {
          ctx.log.warn(
            { err: err instanceof Error ? err.message : err },
            'tenant-prospector: auto-approve check for promote_to_trial failed, defaulting to pending',
          );
        }

        await db.insert(agentApprovals).values({
          agentRunId: ctx.runId,
          kind: 'prospect_promote_to_trial',
          payload: promotePayload as object,
          status: promoteApprovalStatus,
          decidedBy: promoteApprovalStatus === 'auto_approved'
            ? `auto-rule:${promoteRuleMatched ?? 'unknown'}`
            : null,
          decidedAt: promoteApprovalStatus === 'auto_approved' ? new Date() : null,
          ruleMatched: promoteRuleMatched ?? null,
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        });

        ctx.log.info(
          { prospectId, score, status: promoteApprovalStatus },
          'prospect_promote_to_trial approval queued',
        );
      }
      // ── End approval gate ────────────────────────────────────────────────────
    }

    ctx.log.info(
      {
        siteId: input.site_id,
        found: places.length,
        inserted,
        skippedDuplicates,
        skippedNoPhone,
        skippedSelf,
        enriched,
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
      enriched,
    };
  }
}

/**
 * Wrap Apollo's findOwnerByDomain so a single failed lookup can't break the
 * whole prospecting run. Network blips, 404s, masked emails — all logged
 * but treated as "no enrichment, continue with Google Places data alone."
 */
async function safeFindOwner(
  websiteUri: string,
  ctx: AgentContext,
): Promise<Awaited<ReturnType<typeof findOwnerByDomain>>> {
  try {
    return await findOwnerByDomain(websiteUri);
  } catch (err) {
    ctx.log.warn(
      { err: err instanceof Error ? err.message : err, website: websiteUri },
      'apollo enrichment failed — continuing without it',
    );
    return null;
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
