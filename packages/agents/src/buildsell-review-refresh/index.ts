import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, buildsellSites } from '@leadlandlord/db';
import { getPlaceDetails } from '@leadlandlord/integrations/google-places';
import { createWriteClient } from '@leadlandlord/integrations/sanity';
import { buildsellSiteDocId } from '@leadlandlord/sanity-schema/ids';
import { BaseAgent, type AgentContext } from '../base';

/**
 * Build & Sell monthly review refresh.
 *
 * Re-fetches a non-draft B&S site's **aggregate** Google rating + review count
 * (the real, non-PII numbers from Places metadata) and writes them to Postgres
 * (`buildsell_sites.metadata`) + the Sanity `bs-site-${id}` doc, so the rating
 * shown in the hero / sticky nav / ReviewsBlock stays current after it was
 * captured once at build time. site-host renders the Sanity doc per request, so
 * the patch is live immediately — no rebuild, no redeploy.
 *
 * ToS GUARD (ADR 0025 D5 / R6): this NEVER fetches, stores, or displays verbatim
 * Google review text. It touches only the aggregate `rating` + `reviewCount`
 * (the schema itself flags these "Non-PII"). The `bsReview` testimonial cards
 * (AI-written, source:'manual') and the omitted JSON-LD AggregateRating are
 * left untouched.
 *
 * Scoped to non-draft sites: the scheduler only enqueues `status IN ('paid',
 * 'live')` rows that have a `place_id`; the agent re-checks defensively.
 */
const Input = z.object({
  buildsell_site_id: z.string().uuid(),
});
type Input = z.infer<typeof Input>;

const Output = z.object({
  updated: z.boolean(),
  rating: z.number().optional(),
  reviewCount: z.number().optional(),
  /** Set when no write happened (site_not_found / status_* / no_place_id / no_rating_data / unchanged). */
  skippedReason: z.string().optional(),
});
type Output = z.infer<typeof Output>;

/** Calendar-month key (YYYY-MM) — the refresh cadence anchor for idempotency. */
function monthKey(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export class BuildsellReviewRefresh extends BaseAgent<typeof Input, typeof Output> {
  constructor() {
    super({
      name: 'buildsell-review-refresh',
      inputSchema: Input,
      outputSchema: Output,
      // Idempotent per site per calendar month: a duplicate event in the same
      // month returns the cached run (no extra Places call) via
      // findExistingSuccess; next month's key forces a fresh fetch.
      dedupeKeyFn: (input) => `buildsell-review-refresh:${input.buildsell_site_id}:${monthKey()}`,
      // Places spend is bounded by the integration's own daily cap, not the
      // agent budget (no model tokens flow through recordUsage here).
      defaultDailyCapUsd: 1,
    });
  }

  protected async execute(input: Input, ctx: AgentContext): Promise<Output> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(buildsellSites)
      .where(eq(buildsellSites.id, input.buildsell_site_id))
      .limit(1);

    if (!row) {
      return { updated: false, skippedReason: 'site_not_found' };
    }
    // Defensive: the scheduler already filters to paid/live, but an event can
    // sit in the queue across a status change. Never refresh a draft site.
    if (row.status !== 'paid' && row.status !== 'live') {
      return { updated: false, skippedReason: `status_${row.status}` };
    }
    if (!row.placeId) {
      // Sites built from reaped leads can have a null place_id.
      return { updated: false, skippedReason: 'no_place_id' };
    }

    const { rating, userRatingCount } = await getPlaceDetails(row.placeId);
    if (rating == null && userRatingCount == null) {
      return { updated: false, skippedReason: 'no_rating_data' };
    }

    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const prevRating = typeof meta.rating === 'number' ? meta.rating : undefined;
    const prevCount = typeof meta.userRatingCount === 'number' ? meta.userRatingCount : undefined;
    if (prevRating === rating && prevCount === userRatingCount) {
      ctx.log.info(
        { buildsell_site_id: input.buildsell_site_id, rating, userRatingCount },
        'buildsell-review-refresh: unchanged, no write',
      );
      return { updated: false, rating, reviewCount: userRatingCount, skippedReason: 'unchanged' };
    }

    // Postgres: merge the aggregate into metadata + stamp the sync time.
    await db
      .update(buildsellSites)
      .set({
        metadata: { ...meta, rating, userRatingCount, reviewsSyncedAt: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(eq(buildsellSites.id, input.buildsell_site_id));

    // Sanity: patch the rendered aggregate fields on the bs-site doc. Single-
    // field patch (not createOrReplace) — never clobbers builder-owned content.
    await createWriteClient()
      .patch(buildsellSiteDocId(input.buildsell_site_id))
      .set({
        ...(rating != null ? { rating } : {}),
        ...(userRatingCount != null ? { reviewCount: userRatingCount } : {}),
      })
      .commit({ visibility: 'sync' });

    ctx.log.info(
      { buildsell_site_id: input.buildsell_site_id, rating, userRatingCount },
      'buildsell-review-refresh: updated',
    );
    return { updated: true, rating, reviewCount: userRatingCount };
  }
}
