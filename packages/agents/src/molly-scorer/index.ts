/**
 * MollyScorer — weekly Haiku scoring pass that picks the top-5 backlink
 * prospect domains for a site and writes scores + rationales back to
 * `backlink_prospects`.
 *
 * Input: { siteId }
 * Flow:
 *   1. Site eligibility guard: status='live' AND deployedAt older than 28 days.
 *      Returns graceful no-op when ineligible.
 *   2. Pull up to 20 `backlink_prospects` rows with status='prospected',
 *      excluding any with metadata->>'snoozedUntil' in the future.
 *   3. DA filter: drop rows with domain_rank < 25 OR domain_rank > 60 (leave
 *      status unchanged — a future DA refresh might bring them in-range).
 *   4. Load the 20 most recent backlinkNicheTastes rows for the site's niche
 *      and inject them into the Haiku scoring prompt as a penalty signal.
 *   5. Receptivity check: call scrapeReceptivity per remaining prospect (<=3
 *      Firecrawl URLs each). Stash results in metadata.receptivity.
 *   6. Single batched Haiku call: score all remaining prospects 0-100 with
 *      a one-sentence rationale.
 *   7. Write back scores; mark top-5 as `flagged_top5`; mark the rest `scored`.
 *      Exclude already-snoozed rows from top-5 selection and count.
 *   8. For the top-5 only: attempt contact discovery (Apollo, then Firecrawl
 *      scrapeContact). Write contactEmail/contactName/contactState on success.
 *      Never overwrite an existing contactEmail.
 *
 * Cost per run: ~$0.001 (Haiku) + ~$0.025 (Firecrawl, 5 x $0.005).
 * dedupeKeyFn: 'molly-scorer:<siteId>:<YYYYMMDD>' — one run per site per day.
 * defaultDailyCapUsd: $1.
 */

import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import {
  getDb,
  backlinkProspects,
  backlinkNicheTastes,
  sites,
} from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { scrapeReceptivity } from '@leadlandlord/integrations/firecrawl';
import { BaseAgent, type AgentContext } from '../base';
import { log as rootLog } from '@leadlandlord/shared/log';

// ── Schemas ──────────────────────────────────────────────────────────────────

export const MollyScorerInput = z.object({
  siteId: z.string().uuid(),
});
export type MollyScorerInput = z.infer<typeof MollyScorerInput>;

export const MollyScorerOutput = z.object({
  siteId: z.string().uuid(),
  /** True when the site did not meet eligibility criteria (not live or < 28d old). */
  skippedIneligible: z.boolean().optional(),
  /** Prospects pulled from DB before DA filter. */
  prospectsPulled: z.number(),
  /** Prospects dropped by DA filter (outside 25-60). */
  droppedByDaFilter: z.number(),
  /** Prospects that passed DA filter and were scored. */
  prospectsScoredCount: z.number(),
  /** IDs of the top-5 prospects flagged for operator review. */
  top5Ids: z.array(z.string().uuid()),
  /** Number of top-5 prospects that had contact info successfully discovered. */
  contactsFound: z.number(),
});
export type MollyScorerOutput = z.infer<typeof MollyScorerOutput>;

// ── Haiku response schema ─────────────────────────────────────────────────────

const HaikuProspectScore = z.object({
  prospectId: z.string(),
  score: z.number().min(0).max(100),
  rationale: z.string(),
});

const HaikuResponse = z.object({
  scores: z.array(HaikuProspectScore),
});

// ── Haiku model ───────────────────────────────────────────────────────────────

const SCORER_MODEL = 'claude-haiku-4-5';

// ── DA filter bounds (ADR-0006 locked decision #4) ───────────────────────────

const DA_MIN = 25;
const DA_MAX = 60;

// ── Site eligibility: must be live and at least 28 days post-deploy ───────────

const ELIGIBILITY_MIN_DAYS = 28;

// ── Taste profile: max rows to pull per niche, max reason chars ───────────────

const TASTE_PROFILE_MAX_ROWS = 20;
const TASTE_REASON_MAX_CHARS = 100;

// ── Agent ─────────────────────────────────────────────────────────────────────

export class MollyScorer extends BaseAgent<typeof MollyScorerInput, typeof MollyScorerOutput> {
  constructor() {
    super({
      name: 'molly-scorer',
      inputSchema: MollyScorerInput,
      outputSchema: MollyScorerOutput,
      dedupeKeyFn: (input) => {
        const now = new Date();
        const ymd = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
        return `molly-scorer:${input.siteId}:${ymd}`;
      },
      defaultDailyCapUsd: 1,
    });
  }

  protected async execute(
    input: MollyScorerInput,
    ctx: AgentContext,
  ): Promise<MollyScorerOutput> {
    const db = getDb();
    const log = rootLog.child({ agent: 'molly-scorer', siteId: input.siteId, runId: ctx.runId });

    // ── 0. Load site context ─────────────────────────────────────────────────
    const site = (
      await db.select().from(sites).where(eq(sites.id, input.siteId)).limit(1)
    )[0];
    if (!site) throw new Error(`site ${input.siteId} not found`);

    // ── 0a. Site eligibility guard ───────────────────────────────────────────
    // Require status='live' AND deployedAt older than 28 days. Returning a
    // graceful no-op avoids wasting Firecrawl/Haiku budget on sites not yet
    // earning organic traffic, and prevents surfacing prospects for sites the
    // operator hasn't verified are live.
    const eligibilityReason = checkSiteEligibility(site);
    if (eligibilityReason) {
      log.info({ reason: eligibilityReason }, 'site not eligible for scoring — skip');
      return {
        siteId: input.siteId,
        skippedIneligible: true,
        prospectsPulled: 0,
        droppedByDaFilter: 0,
        prospectsScoredCount: 0,
        top5Ids: [],
        contactsFound: 0,
      };
    }

    // ── 1. Pull prospected rows (excluding snoozed) ──────────────────────────
    // Snooze: metadata->>'snoozedUntil' is an ISO timestamp stored in the
    // jsonb blob. We exclude rows where that value is in the future so
    // snoozed prospects don't consume scoring budget until they wake up.
    ctx.progress({ label: 'loading prospects' });
    const rows = await db
      .select()
      .from(backlinkProspects)
      .where(
        and(
          eq(backlinkProspects.siteId, input.siteId),
          eq(backlinkProspects.status, 'prospected'),
          // Exclude rows that the operator has snoozed until a future date.
          sql`(${backlinkProspects.metadata}->>'snoozedUntil' IS NULL OR (${backlinkProspects.metadata}->>'snoozedUntil')::timestamptz <= NOW())`,
        ),
      )
      .limit(20);

    if (rows.length === 0) {
      log.info('no prospected rows (or all snoozed) — no-op');
      return {
        siteId: input.siteId,
        prospectsPulled: 0,
        droppedByDaFilter: 0,
        prospectsScoredCount: 0,
        top5Ids: [],
        contactsFound: 0,
      };
    }

    const prospectsPulled = rows.length;

    // ── 2. DA filter ─────────────────────────────────────────────────────────
    // Drop outside 25-60. Leave status = 'prospected' — a future DA refresh
    // might move them into range. Don't delete.
    const eligible = rows.filter((r) => {
      const rank = r.domainRank;
      // null DA: pass through — we don't have data to filter on;
      // Haiku prompt will note "DA unknown, judge on relevance/receptivity".
      if (rank == null) return true;
      return rank >= DA_MIN && rank <= DA_MAX;
    });
    const droppedByDaFilter = prospectsPulled - eligible.length;
    log.info({ prospectsPulled, eligible: eligible.length, dropped: droppedByDaFilter }, 'DA filter applied');

    if (eligible.length === 0) {
      log.info('all prospects outside DA range — no-op');
      return {
        siteId: input.siteId,
        prospectsPulled,
        droppedByDaFilter,
        prospectsScoredCount: 0,
        top5Ids: [],
        contactsFound: 0,
      };
    }

    // ── 3. Taste profile ─────────────────────────────────────────────────────
    // Load the 20 most recent rejection signals for this niche. These tell
    // Haiku what kinds of domains the operator keeps rejecting so it can
    // apply a penalty to similar prospects.
    ctx.progress({ label: 'loading taste profile' });
    const siteNiche = (site.niche ?? '').toLowerCase();
    const tasteRows = await db
      .select({
        domain: backlinkNicheTastes.domain,
        reason: backlinkNicheTastes.reason,
      })
      .from(backlinkNicheTastes)
      .where(eq(backlinkNicheTastes.niche, siteNiche))
      .orderBy(sql`${backlinkNicheTastes.recordedAt} DESC`)
      .limit(TASTE_PROFILE_MAX_ROWS);

    // Build a compact taste profile section (domain + truncated reason, one
    // line each). Only injected into the prompt when there is feedback to apply.
    const tasteProfileSection =
      tasteRows.length > 0
        ? [
            'The operator has previously rejected these domains for this niche (penalize similar prospects):',
            ...tasteRows.map(
              (t) => `  ${t.domain} — ${t.reason.slice(0, TASTE_REASON_MAX_CHARS)}`,
            ),
          ].join('\n')
        : '';

    log.info({ tasteRows: tasteRows.length }, 'taste profile loaded');

    // ── 4. Receptivity check ─────────────────────────────────────────────────
    ctx.progress({ label: `checking receptivity for ${eligible.length} domains`, step: 0, total: eligible.length });

    const receptivityMap = new Map<string, Awaited<ReturnType<typeof scrapeReceptivity>>>();
    for (let i = 0; i < eligible.length; i++) {
      const row = eligible[i]!;
      ctx.progress({ label: `receptivity: ${row.domain}`, step: i + 1, total: eligible.length });
      try {
        const result = await scrapeReceptivity(row.domain);
        receptivityMap.set(row.id, result);

        // Persist receptivity into metadata so it's queryable later without
        // re-scraping.
        const existing = (row.metadata ?? {}) as Record<string, unknown>;
        await db
          .update(backlinkProspects)
          .set({
            metadata: { ...existing, receptivity: result },
            updatedAt: new Date(),
          })
          .where(eq(backlinkProspects.id, row.id));
      } catch (err) {
        log.warn({ domain: row.domain, err: err instanceof Error ? err.message : err }, 'receptivity check failed — continuing');
        receptivityMap.set(row.id, { receptive: false, signals: [], sampledUrls: [] });
      }
    }

    // ── 5. Batched Haiku scoring call ─────────────────────────────────────────
    ctx.progress({ label: 'scoring with Haiku' });

    const scoringPayload = eligible.map((r) => ({
      prospectId: r.id,
      domain: r.domain,
      domainRank: r.domainRank,
      receptive: receptivityMap.get(r.id)?.receptive ?? false,
      receptivitySignals: receptivityMap.get(r.id)?.signals ?? [],
      niche: site.niche,
      city: site.city,
    }));

    // Taste profile is appended when non-empty; the blank line keeps the
    // boundary visually clear for the model.
    const systemPrompt = [
      `You are Molly Matthews, Sr. Outreach Manager at LeadLandlord.`,
      `Your job is to score candidate guest-post domains for relevance and outreach likelihood.`,
      ``,
      `Scoring criteria (0-100):`,
      `- Niche relevance: does the blog cover topics related to ${site.niche} in or near ${site.city}? (40 points)`,
      `- Guest-post receptivity: does the site show signals of accepting guest posts? (30 points)`,
      `- Domain authority quality: DA 35-50 is ideal, score accordingly (30 points). When domainRank is null, DA is unknown — judge on relevance/receptivity instead and note "DA unknown" in the rationale.`,
      ...(tasteProfileSection ? ['', tasteProfileSection] : []),
      ``,
      `Return ONLY valid JSON matching this schema:`,
      `{`,
      `  "scores": [`,
      `    { "prospectId": "<uuid>", "score": <0-100>, "rationale": "<25 words max>" }`,
      `  ]`,
      `}`,
      ``,
      `Sort the array by score descending. Do not include commentary outside the JSON object.`,
    ].join('\n');

    const userMessage = `Score these ${eligible.length} prospect domains:\n\n${JSON.stringify(scoringPayload, null, 2)}`;

    const anthropic = getAnthropicClient();
    let top5Ids: string[] = [];
    let prospectsScoredCount = 0;

    try {
      const response = await anthropic.messages.create({
        model: SCORER_MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const usage = response.usage;
      ctx.recordUsage({
        model: SCORER_MODEL,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cost_usd: estimateCostUsd(SCORER_MODEL, {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
        }),
      });

      // Extract text content
      const textBlock = response.content.find((b) => b.type === 'text');
      const rawText = textBlock && textBlock.type === 'text' ? textBlock.text : '';

      // Parse — extract JSON even if model wraps it in markdown fences.
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Haiku returned no JSON object');

      const parsed = HaikuResponse.parse(JSON.parse(jsonMatch[0]));
      const scored = parsed.scores;

      // Validate that returned IDs are a subset of what we sent.
      const eligibleIds = new Set(eligible.map((r) => r.id));
      const validScores = scored.filter((s) => eligibleIds.has(s.prospectId));

      if (validScores.length === 0) {
        throw new Error('Haiku returned no scores matching input prospect IDs');
      }

      // Top 5 by score — but exclude any row that has become snoozed between
      // the initial pull and now. Re-check the in-memory metadata field;
      // a race where the operator snoozes during scoring is rare but possible.
      const now = new Date();
      const sorted = [...validScores].sort((a, b) => b.score - a.score);

      const eligibleById = new Map(eligible.map((r) => [r.id, r]));
      const filteredForTop5 = sorted.filter((s) => {
        const row = eligibleById.get(s.prospectId);
        if (!row) return false;
        const meta = (row.metadata ?? {}) as Record<string, unknown>;
        const snoozedUntil = meta['snoozedUntil'];
        if (typeof snoozedUntil === 'string' && new Date(snoozedUntil) > now) return false;
        return true;
      });

      top5Ids = filteredForTop5.slice(0, 5).map((s) => s.prospectId);
      const top5Set = new Set(top5Ids);

      // Write scores back. Two update types: flagged_top5 (top 5) and scored (rest).
      for (const s of validScores) {
        const isTop5 = top5Set.has(s.prospectId);
        await db
          .update(backlinkProspects)
          .set({
            score: String(s.score),
            rationale: s.rationale.slice(0, 200),
            status: isTop5 ? 'flagged_top5' : 'scored',
            flaggedTop5At: isTop5 ? now : undefined,
            updatedAt: now,
          })
          .where(eq(backlinkProspects.id, s.prospectId));
      }

      prospectsScoredCount = validScores.length;
      log.info({ scored: prospectsScoredCount, top5: top5Ids.length }, 'scoring complete');
    } catch (err) {
      // Malformed JSON or ID mismatch — degrade gracefully: mark all eligible
      // rows as scored with null score so they don't re-enter the batch.
      log.error(
        { err: err instanceof Error ? err.message : err },
        'Haiku scoring failed — marking all eligible as scored with null score',
      );
      const now = new Date();
      for (const row of eligible) {
        await db
          .update(backlinkProspects)
          .set({ status: 'scored', updatedAt: now })
          .where(eq(backlinkProspects.id, row.id));
      }
      prospectsScoredCount = eligible.length;
      top5Ids = [];

      return {
        siteId: input.siteId,
        prospectsPulled,
        droppedByDaFilter,
        prospectsScoredCount,
        top5Ids,
        contactsFound: 0,
      };
    }

    // Contact discovery removed from scorer (ADR-0006 revision): discovery
    // now runs in pitch mode after operator approval. contactsFound kept at 0
    // for schema compatibility.

    return {
      siteId: input.siteId,
      prospectsPulled,
      droppedByDaFilter,
      prospectsScoredCount,
      top5Ids,
      contactsFound: 0,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a reason string if the site is ineligible for scoring, or null when
 * it passes both checks. Kept pure (no DB calls) so it is trivially testable.
 *
 * Eligibility criteria:
 *   1. sites.status must be 'live'.
 *   2. sites.deployedAt must be at least 28 days in the past.
 *
 * The 28-day minimum gives the site time to index before we chase backlinks.
 */
function checkSiteEligibility(
  site: { status: string; deployedAt: Date | null },
): string | null {
  if (site.status !== 'live') {
    return `status is '${site.status}', not 'live'`;
  }
  if (!site.deployedAt) {
    return 'deployedAt is null';
  }
  const ageMs = Date.now() - new Date(site.deployedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < ELIGIBILITY_MIN_DAYS) {
    return `deployedAt is only ${Math.floor(ageDays)}d ago (need ${ELIGIBILITY_MIN_DAYS}d)`;
  }
  return null;
}
