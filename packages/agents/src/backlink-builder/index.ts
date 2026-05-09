import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { getDb, backlinks, sites, type Site } from '@leadlandlord/db';
import { sendEmail as sendEmailResend } from '@leadlandlord/integrations/resend';
import { sendEmail as sendEmailZoho } from '@leadlandlord/integrations/zoho-mcp';
import { getRemainingSendsToday, recordSend } from '@leadlandlord/db/email-throttle';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { findEditorByDomain } from '@leadlandlord/integrations/apollo';
import {
  getDomainIntersection,
  getReferringDomains,
  isBlockedProspectDomain,
  type ProspectDomain,
} from '@leadlandlord/integrations/dataforseo/backlinks';
import { BaseAgent, type AgentContext } from '../base';
import { ComplianceGuard } from '../compliance-guard/index';
import { CITATION_DIRECTORIES } from './directories';

/**
 * Backlink Builder — three modes, all writing to the `backlinks` table:
 *
 *   citations   — fan out the curated 30-directory list as `pending` rows for
 *                 the operator queue. Most directories aren't programmatically
 *                 submittable; the rows carry submitUrl + instructions in
 *                 metadata so the operator can manually action each one. We
 *                 also expose a BrightLocal seam (see packages/integrations/
 *                 brightlocal) for future paid automation.
 *
 *   haro        — given a HARO/Connectively daily-query feed, draft a pitch
 *                 per relevant query via Claude, run it through compliance-
 *                 guard, and write `pending` rows for operator review. We do
 *                 NOT auto-send — pitches go to the operator queue. (Real
 *                 niche-relevance filtering is intentionally light: the
 *                 caller pre-filters; we re-check by string-matching the
 *                 site's niche against the subject + body.)
 *
 *   guest_post  — given a target domain + niche + editor email, draft an
 *                 outreach email via Claude, run compliance-guard, and SEND
 *                 via the existing Resend pipeline (mirroring outreach-agent's
 *                 email_day_1 pattern). Records the result as a `submitted`
 *                 row when the send succeeds, `rejected` row when compliance
 *                 blocks.
 *
 * Idempotency:
 *   citations:${siteId}:${YYYY-MM}        — one bulk push per site per month
 *   haro:${siteId}:${queryId}             — per query
 *   guest_post:${siteId}:${targetDomain}  — per target
 *
 * Per-row dedupe via the `dedupe_key` column (unique partial index) makes
 * re-runs ON CONFLICT-safe.
 */

export const BacklinkBuilderInput = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('citations'),
    siteId: z.string().uuid(),
    businessName: z.string(),
    address: z.string().optional(),
    phone: z.string(),
    website: z.string().url(),
    description: z.string(),
  }),
  z.object({
    mode: z.literal('haro'),
    siteId: z.string().uuid(),
    queries: z.array(
      z.object({
        id: z.string(),
        subject: z.string(),
        body: z.string(),
        reporter: z.string().optional(),
        deadline: z.string().optional(),
      }),
    ),
  }),
  z.object({
    mode: z.literal('guest_post'),
    siteId: z.string().uuid(),
    targetDomain: z.string(),
    targetEditorEmail: z.string().email(),
    pitchTopic: z.string(),
  }),
  z.object({
    mode: z.literal('prospect'),
    siteId: z.string().uuid(),
    /**
     * Override competitor seeds for this run. When omitted, falls back to
     * `sites.competitor_seeds` for the row. If both are empty, the run
     * aborts (prospect mode requires at least 2 competitor targets for
     * domain_intersection).
     */
    competitorOverride: z.array(z.string()).optional(),
    /** Max prospect domains to consider after DFS + filter (default 50). */
    maxProspects: z.number().int().min(1).max(500).optional(),
    /** Hard cap on Apollo enrichments — the dominant per-prospect cost (default 15). */
    maxApolloEnrichments: z.number().int().min(1).max(100).optional(),
    /** DFS rank floor 0–1000 (default 250). Per-call override of env default. */
    minDomainRank: z.number().int().min(0).max(1000).optional(),
    /**
     * Auto-send drafted pitches via the existing guest_post send pipeline.
     * Default false: prospect runs always queue rows as `pending` for
     * operator review. Flip to true (or per-niche later) once acceptance-
     * rate data justifies removing training wheels.
     */
    autoSend: z.boolean().optional(),
  }),
]);

export type BacklinkBuilderInput = z.infer<typeof BacklinkBuilderInput>;

export const BacklinkBuilderOutput = z.object({
  mode: z.enum(['citations', 'haro', 'guest_post', 'prospect']),
  siteId: z.string().uuid(),
  rowsCreated: z.number(),
  rowsRejected: z.number(),
  rowsSent: z.number(),
  /** Prospect-only: domains DFS surfaced before our quality filter. */
  prospectsDiscovered: z.number().optional(),
  /** Prospect-only: domains for which Apollo returned a usable editor contact. */
  prospectsEnriched: z.number().optional(),
});
export type BacklinkBuilderOutput = z.infer<typeof BacklinkBuilderOutput>;

export class BacklinkBuilder extends BaseAgent<typeof BacklinkBuilderInput, typeof BacklinkBuilderOutput> {
  private readonly compliance = new ComplianceGuard();

  constructor() {
    super({
      name: 'backlink-builder',
      inputSchema: BacklinkBuilderInput,
      outputSchema: BacklinkBuilderOutput,
      // Per spec idempotency rules. citations dedup is monthly so re-running
      // mid-month no-ops via findExistingSuccess. haro dedups per query.
      // guest_post dedups per (site, target).
      dedupeKeyFn: (i) => {
        switch (i.mode) {
          case 'citations': {
            const now = new Date();
            const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
            return `citations:${i.siteId}:${ym}`;
          }
          case 'haro':
            // One run = one query batch. Use a stable hash of query ids so
            // two runs against the same set short-circuit; if the caller
            // batches ANY new query id we pass through and process the lot.
            return `haro:${i.siteId}:${i.queries.map((q) => q.id).sort().join(',')}`;
          case 'guest_post':
            return `guest_post:${i.siteId}:${i.targetDomain.toLowerCase()}`;
          case 'prospect': {
            // Dedupe per (site, date, competitor-set). Including the seed
            // hash means an operator who fixes a typo or swaps competitors
            // gets a fresh run rather than the cached zero-result.
            const now = new Date();
            const ymd = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
            const seeds = (i.competitorOverride ?? [])
              .map((s) => s.toLowerCase().trim())
              .filter(Boolean)
              .sort()
              .join(',');
            const seedTag = seeds ? `:${shortHash(seeds)}` : '';
            return `prospect:${i.siteId}:${ymd}${seedTag}`;
          }
        }
      },
      defaultDailyCapUsd: 5,
    });
  }

  protected async execute(
    input: BacklinkBuilderInput,
    ctx: AgentContext,
  ): Promise<BacklinkBuilderOutput> {
    const db = getDb();
    const site = (await db.select().from(sites).where(eq(sites.id, input.siteId)).limit(1))[0];
    if (!site) throw new Error(`site ${input.siteId} not found`);

    switch (input.mode) {
      case 'citations':
        return this.runCitations(input, site, ctx);
      case 'haro':
        return this.runHaro(input, site, ctx);
      case 'guest_post':
        return this.runGuestPost(input, site, ctx);
      case 'prospect':
        return this.runProspect(input, site, ctx);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Citations
  // ────────────────────────────────────────────────────────────

  private async runCitations(
    input: Extract<BacklinkBuilderInput, { mode: 'citations' }>,
    site: Site,
    ctx: AgentContext,
  ): Promise<BacklinkBuilderOutput> {
    const db = getDb();
    const now = new Date();
    const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    let created = 0;
    for (const dir of CITATION_DIRECTORIES) {
      const dedupeKey = `citation:${input.siteId}:${dir.domain}:${ym}`;
      try {
        const inserted = await db
          .insert(backlinks)
          .values({
            siteId: input.siteId,
            sourceDomain: dir.domain,
            targetUrl: input.website,
            type: 'citation',
            status: 'pending',
            dedupeKey,
            metadata: {
              directoryName: dir.name,
              submitUrl: dir.submitUrl,
              automatable: dir.automatable,
              instructions: dir.instructions,
              business: {
                name: input.businessName,
                address: input.address ?? null,
                phone: input.phone,
                website: input.website,
                description: input.description,
              },
              ym,
            },
          })
          .onConflictDoNothing({
          target: backlinks.dedupeKey,
          where: sql`${backlinks.dedupeKey} IS NOT NULL`,
        })
          .returning({ id: backlinks.id });
        if (inserted.length > 0) created += 1;
      } catch (err) {
        ctx.log.warn(
          { dir: dir.domain, err: err instanceof Error ? err.message : String(err) },
          'citation insert failed',
        );
      }
    }

    ctx.log.info({ siteId: site.id, created, total: CITATION_DIRECTORIES.length }, 'citations queued');
    return {
      mode: 'citations',
      siteId: input.siteId,
      rowsCreated: created,
      rowsRejected: 0,
      rowsSent: 0,
    };
  }

  // ────────────────────────────────────────────────────────────
  // HARO
  // ────────────────────────────────────────────────────────────

  private async runHaro(
    input: Extract<BacklinkBuilderInput, { mode: 'haro' }>,
    site: Site,
    ctx: AgentContext,
  ): Promise<BacklinkBuilderOutput> {
    const db = getDb();
    const niche = site.niche.toLowerCase();
    let created = 0;
    let rejected = 0;

    for (const q of input.queries) {
      // Light niche filter: the caller is expected to pre-filter, but we
      // still gate to avoid pitching off-topic queries which would burn
      // Claude tokens for no reason.
      const blob = `${q.subject} ${q.body}`.toLowerCase();
      if (!blob.includes(niche)) {
        ctx.log.info({ queryId: q.id, niche }, 'haro: query did not match niche, skipping');
        continue;
      }

      const dedupeKey = `haro:${input.siteId}:${q.id}`;
      const draft = await this.draftHaroPitch(q, site, ctx);
      const subject = `Source for: ${q.subject.slice(0, 80)}`;

      // Compliance gate. HARO pitches don't need CAN-SPAM unsubscribe
      // boilerplate (one-to-one journalist response, not bulk outreach), so
      // the scope is site_content (warning-only) — we want to flag fake
      // claims/license numbers but not block on lack of unsubscribe.
      const compliance = await this.compliance.run(
        { scope: 'site_content', text: draft },
        { siteId: site.id, parentRunId: ctx.runId },
      );

      const status: 'pending' | 'rejected' = compliance.ok ? 'pending' : 'rejected';
      const rejectionReason = compliance.ok
        ? null
        : compliance.violations
            .filter((v) => v.severity === 'blocker')
            .map((v) => `${v.rule}: ${v.message}`)
            .join('; ') || null;

      const inserted = await db
        .insert(backlinks)
        .values({
          siteId: input.siteId,
          sourceDomain: 'helpareporter.com',
          targetUrl: null,
          type: 'haro',
          status,
          dedupeKey,
          pitchDraft: draft,
          subjectLine: subject,
          rejectionReason,
          metadata: {
            queryId: q.id,
            querySubject: q.subject,
            queryBody: q.body,
            reporter: q.reporter ?? null,
            deadline: q.deadline ?? null,
            complianceViolations: compliance.violations,
          },
        })
        .onConflictDoNothing({
          target: backlinks.dedupeKey,
          where: sql`${backlinks.dedupeKey} IS NOT NULL`,
        })
        .returning({ id: backlinks.id });

      if (inserted.length > 0) {
        if (status === 'rejected') rejected += 1;
        else created += 1;
      }
    }

    return {
      mode: 'haro',
      siteId: input.siteId,
      rowsCreated: created,
      rowsRejected: rejected,
      rowsSent: 0,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Guest post
  // ────────────────────────────────────────────────────────────

  private async runGuestPost(
    input: Extract<BacklinkBuilderInput, { mode: 'guest_post' }>,
    site: Site,
    ctx: AgentContext,
    opts?: { queueOnly?: boolean; extraMetadata?: Record<string, unknown>; dedupeKey?: string },
  ): Promise<BacklinkBuilderOutput> {
    const db = getDb();
    const dedupeKey = opts?.dedupeKey ?? `guest_post:${input.siteId}:${input.targetDomain.toLowerCase()}`;
    const queueOnly = opts?.queueOnly === true;

    const { subject, body } = await this.draftGuestPostEmail(input, site, ctx);

    // Full CAN-SPAM compliance check — this is a real outbound email send.
    const compliance = await this.compliance.run(
      {
        scope: 'outreach_email',
        text: body,
        recipient: input.targetEditorEmail,
      },
      { siteId: site.id, parentRunId: ctx.runId },
    );

    if (!compliance.ok) {
      const reason = compliance.violations
        .filter((v) => v.severity === 'blocker')
        .map((v) => `${v.rule}: ${v.message}`)
        .join('; ') || 'compliance blocked';
      await db
        .insert(backlinks)
        .values({
          siteId: input.siteId,
          sourceDomain: input.targetDomain.toLowerCase(),
          targetUrl: null,
          type: 'guest_post',
          status: 'rejected',
          dedupeKey,
          pitchDraft: body,
          subjectLine: subject,
          rejectionReason: reason,
          metadata: {
            targetEditorEmail: input.targetEditorEmail,
            pitchTopic: input.pitchTopic,
            complianceViolations: compliance.violations,
            ...(opts?.extraMetadata ?? {}),
          },
        })
        .onConflictDoNothing({
          target: backlinks.dedupeKey,
          where: sql`${backlinks.dedupeKey} IS NOT NULL`,
        });
      return {
        mode: 'guest_post',
        siteId: input.siteId,
        rowsCreated: 0,
        rowsRejected: 1,
        rowsSent: 0,
      };
    }

    // Queue-only path — used by prospect mode and any caller that wants
    // operator review before sending. Drafts and compliance still ran
    // above; we just write a `pending` row instead of dispatching the
    // email. The operator UI sends from the queue.
    if (queueOnly) {
      await db
        .insert(backlinks)
        .values({
          siteId: input.siteId,
          sourceDomain: input.targetDomain.toLowerCase(),
          targetUrl: null,
          type: 'guest_post',
          status: 'pending',
          dedupeKey,
          pitchDraft: body,
          subjectLine: subject,
          rejectionReason: null,
          metadata: {
            targetEditorEmail: input.targetEditorEmail,
            pitchTopic: input.pitchTopic,
            queueOnly: true,
            ...(opts?.extraMetadata ?? {}),
          },
        })
        .onConflictDoNothing({
          target: backlinks.dedupeKey,
          where: sql`${backlinks.dedupeKey} IS NOT NULL`,
        });
      return {
        mode: 'guest_post',
        siteId: input.siteId,
        rowsCreated: 1,
        rowsRejected: 0,
        rowsSent: 0,
      };
    }

    // Provider selection: Zoho MCP behind a feature flag, otherwise Resend.
    // Read env on each invocation (no module-level caching).
    const useZoho = process.env.ZOHO_MCP_ENABLED === 'true';
    const mailbox = useZoho
      ? (process.env.ZOHO_DEFAULT_FROM ?? '')
      : (process.env.RESEND_FROM_ADDRESS ?? '');
    if (!mailbox) {
      throw new Error(useZoho ? 'ZOHO_DEFAULT_FROM not set' : 'RESEND_FROM_ADDRESS not set');
    }

    // Throttle check (only meaningful when useZoho — Resend has its own caps).
    let throttled = false;
    if (useZoho) {
      const { remaining, cap, sentToday } = await getRemainingSendsToday(mailbox);
      ctx.log.info({ mailbox, remaining, cap, sentToday }, 'guest_post: throttle check');
      if (remaining <= 0) throttled = true;
    }

    if (throttled) {
      await recordSend({
        siteId: input.siteId,
        mailbox,
        toAddress: input.targetEditorEmail,
        subject,
        purpose: 'guest_post',
        provider: 'zoho',
        status: 'throttled',
        metadata: { reason: 'daily_cap_reached' },
      });
      await db
        .insert(backlinks)
        .values({
          siteId: input.siteId,
          sourceDomain: input.targetDomain.toLowerCase(),
          targetUrl: null,
          type: 'guest_post',
          status: 'pending',
          dedupeKey,
          pitchDraft: body,
          subjectLine: subject,
          rejectionReason: null,
          metadata: {
            targetEditorEmail: input.targetEditorEmail,
            pitchTopic: input.pitchTopic,
            throttled: true,
            ...(opts?.extraMetadata ?? {}),
          },
        })
        .onConflictDoNothing({
          target: backlinks.dedupeKey,
          where: sql`${backlinks.dedupeKey} IS NOT NULL`,
        });
      return {
        mode: 'guest_post',
        siteId: input.siteId,
        rowsCreated: 1,
        rowsRejected: 0,
        rowsSent: 0,
      };
    }

    // Send.
    let externalId: string | undefined;
    let sendError: string | undefined;
    try {
      if (useZoho) {
        const res = await sendEmailZoho({
          to: input.targetEditorEmail,
          from: mailbox,
          subject,
          text: body,
        });
        externalId = res.messageId;
      } else {
        const res = await sendEmailResend({
          to: input.targetEditorEmail,
          from: mailbox,
          subject,
          text: body,
        });
        externalId = res.messageId;
      }
    } catch (err) {
      sendError = err instanceof Error ? err.message : String(err);
      ctx.log.error({ err: sendError, targetDomain: input.targetDomain }, 'guest_post send failed');
    }

    await recordSend({
      siteId: input.siteId,
      mailbox,
      toAddress: input.targetEditorEmail,
      subject,
      purpose: 'guest_post',
      provider: useZoho ? 'zoho' : 'resend',
      externalId: externalId ?? null,
      status: sendError ? 'failed' : 'sent',
      errorMessage: sendError ?? null,
    });

    const status = sendError ? 'pending' : 'submitted';
    await db
      .insert(backlinks)
      .values({
        siteId: input.siteId,
        sourceDomain: input.targetDomain.toLowerCase(),
        targetUrl: null,
        type: 'guest_post',
        status,
        dedupeKey,
        pitchDraft: body,
        subjectLine: subject,
        rejectionReason: sendError ? `send_failed: ${sendError}` : null,
        metadata: {
          targetEditorEmail: input.targetEditorEmail,
          pitchTopic: input.pitchTopic,
          externalId: externalId ?? null,
          sendError: sendError ?? null,
          ...(opts?.extraMetadata ?? {}),
        },
      })
      .onConflictDoNothing({
          target: backlinks.dedupeKey,
          where: sql`${backlinks.dedupeKey} IS NOT NULL`,
        });

    return {
      mode: 'guest_post',
      siteId: input.siteId,
      rowsCreated: sendError ? 1 : 0,
      rowsRejected: 0,
      rowsSent: sendError ? 0 : 1,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Claude drafts
  // ────────────────────────────────────────────────────────────

  private async draftHaroPitch(
    q: { id: string; subject: string; body: string; reporter?: string; deadline?: string },
    site: Site,
    ctx: AgentContext,
  ): Promise<string> {
    const client = getAnthropicClient();
    const model = process.env.BACKLINK_BUILDER_MODEL ?? 'claude-haiku-4-5';
    const userPrompt = `You are responding to a HARO/Connectively reporter query as a local ${site.niche} business in ${site.city}, ${site.state}.

Reporter query subject: ${q.subject}
Query body:
${q.body}

Write a concise (150–220 words) source pitch:
- Open with one sentence on who the source is (a ${site.niche} business operating in ${site.city}).
- Answer the reporter's question with 2–3 specific, factual points based on common ${site.niche} domain knowledge. No fabricated statistics or fake credentials.
- Offer to expand on any point. Sign off as "${site.niche} team — ${site.city}, ${site.state}".

Tone: helpful expert, no marketing fluff. No links. No claims like "best in state" or specific license numbers.`;

    const response = await client.messages.create({
      model,
      max_tokens: 600,
      temperature: 0.5,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
    };
    ctx.recordUsage({ model, ...usage, cost_usd: estimateCostUsd(model, usage) });
    const text = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    return text || `Source available: ${site.niche} business in ${site.city}, ${site.state}.`;
  }

  private async draftGuestPostEmail(
    input: Extract<BacklinkBuilderInput, { mode: 'guest_post' }>,
    site: Site,
    ctx: AgentContext,
  ): Promise<{ subject: string; body: string }> {
    const client = getAnthropicClient();
    const model = process.env.BACKLINK_BUILDER_MODEL ?? 'claude-haiku-4-5';
    const postalAddress = process.env.LEADLANDLORD_POSTAL_ADDRESS
      ?? `LeadLandlord, [postal address not set], ${site.city}, ${site.state}`;
    const userPrompt = `Draft a short, sincere guest-post pitch email to the editor of ${input.targetDomain}.

Sender: a ${site.niche} business in ${site.city}, ${site.state}.
Pitch topic: ${input.pitchTopic}

Constraints:
- Subject line: <= 60 chars, specific.
- Body: ~120 words, plain text.
- Suggest 2 concrete article angles relevant to ${input.targetDomain}'s audience.
- Include an unsubscribe line: "Reply with REMOVE if you'd rather not hear from me again."
- Include a postal address line on its own line: "${postalAddress}".
- Sign off "— ${site.niche} team in ${site.city}".
- No fake credentials, no superlatives.

Return strictly JSON: {"subject": "...", "body": "..."}.`;

    const response = await client.messages.create({
      model,
      max_tokens: 800,
      temperature: 0.5,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
    };
    ctx.recordUsage({ model, ...usage, cost_usd: estimateCostUsd(model, usage) });
    const text = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();

    try {
      // Strip code fences if present.
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
      const parsed = JSON.parse(cleaned) as { subject?: unknown; body?: unknown };
      if (typeof parsed.subject === 'string' && typeof parsed.body === 'string') {
        return { subject: parsed.subject, body: parsed.body };
      }
    } catch {
      // fall through to fallback below
    }
    ctx.log.warn({ targetDomain: input.targetDomain }, 'guest_post: Claude response not JSON, using fallback');
    return {
      subject: `Guest post idea for ${input.targetDomain}`,
      body: [
        `Hi,`,
        ``,
        `I run a ${site.niche} business in ${site.city}, ${site.state} and put together a quick angle on "${input.pitchTopic}" that I think would land with your readers.`,
        ``,
        `Happy to send a 700-word draft if you're open to a contributor piece.`,
        ``,
        `Reply with REMOVE if you'd rather not hear from me again.`,
        ``,
        `— ${site.niche} team in ${site.city}`,
        postalAddress,
      ].join('\n'),
    };
  }

  // ────────────────────────────────────────────────────────────
  // Prospect (DataForSEO discovery → Apollo enrichment → guest_post queue)
  // ────────────────────────────────────────────────────────────

  /**
   * Mine guest-post prospects for a site:
   *   1. Pull competitor seeds (override → site.competitor_seeds).
   *   2. DataForSEO `domain_intersection` (or `referring_domains` fallback
   *      when only 1 seed) returns referring-domain candidates.
   *   3. Apply blocklist + already-seen filter, cap to maxProspects.
   *   4. For each survivor, Apollo `findEditorByDomain` (capped at
   *      maxApolloEnrichments — the dominant variable cost).
   *   5. Each enriched prospect → existing `runGuestPost` with queueOnly
   *      (default) or auto-send (when input.autoSend === true).
   *
   * Provenance is stamped into `backlinks.metadata.prospect` so the
   * operator UI can compute acceptance rates by rank-band, editor title,
   * niche etc. — the signals we need to graduate to full autonomy.
   */
  private async runProspect(
    input: Extract<BacklinkBuilderInput, { mode: 'prospect' }>,
    site: Site,
    ctx: AgentContext,
  ): Promise<BacklinkBuilderOutput> {
    const seeds = (input.competitorOverride ?? site.competitorSeeds ?? []).filter(
      (d): d is string => typeof d === 'string' && d.trim().length > 0,
    );
    if (seeds.length === 0) {
      ctx.log.warn({ siteId: site.id }, 'prospect: no competitor seeds, aborting');
      return {
        mode: 'prospect',
        siteId: input.siteId,
        rowsCreated: 0,
        rowsRejected: 0,
        rowsSent: 0,
        prospectsDiscovered: 0,
        prospectsEnriched: 0,
      };
    }

    const minRank =
      input.minDomainRank ?? Number(process.env.PROSPECT_MIN_DOMAIN_RANK ?? '50');
    const maxProspects = input.maxProspects ?? 50;
    const requestedApolloMax = input.maxApolloEnrichments ?? 15;
    const autoSend = input.autoSend === true;

    // Apollo monthly cap enforcement (defence-in-depth — operator UI also
    // pre-checks). Each prospect-stamped backlinks row this month consumed
    // one Apollo person-reveal. Free tier is 75/month.
    const apolloCap = Number(process.env.APOLLO_MONTHLY_CAP ?? '75');
    const apolloUsed = await countApolloEnrichmentsThisMonth();
    const apolloRemaining = Math.max(0, apolloCap - apolloUsed);
    if (apolloRemaining <= 0) {
      ctx.log.warn(
        { siteId: site.id, apolloUsed, apolloCap },
        'prospect: Apollo monthly cap reached, aborting',
      );
      return {
        mode: 'prospect',
        siteId: input.siteId,
        rowsCreated: 0,
        rowsRejected: 0,
        rowsSent: 0,
        prospectsDiscovered: 0,
        prospectsEnriched: 0,
      };
    }
    const maxApolloEnrichments = Math.min(requestedApolloMax, apolloRemaining);

    // 1. Discovery.
    let candidates: ProspectDomain[] = [];
    try {
      if (seeds.length >= 2) {
        candidates = await getDomainIntersection({
          targets: seeds,
          exclude: site.domain ? [site.domain] : [],
          minRank,
          // Over-fetch so the blocklist + dedupe filter still leaves
          // enough headroom to reach maxProspects.
          limit: maxProspects * 3,
        });
      } else {
        candidates = await getReferringDomains({
          target: seeds[0]!,
          minRank,
          limit: maxProspects * 3,
        });
      }
    } catch (err) {
      ctx.log.error(
        { err: err instanceof Error ? err.message : String(err), seeds: seeds.length },
        'prospect: DFS discovery failed',
      );
      throw err;
    }

    const discovered = candidates.length;
    ctx.log.info({ siteId: site.id, discovered, minRank }, 'prospect: DFS returned candidates');

    // 2. Filter — blocklist, own domain, already-seen.
    const ownDomain = site.domain?.toLowerCase() ?? null;
    const seenKeys = new Set(
      (
        await getDb()
          .select({ k: backlinks.dedupeKey })
          .from(backlinks)
          .where(eq(backlinks.siteId, input.siteId))
      )
        .map((r) => r.k)
        .filter((k): k is string => !!k),
    );

    const filtered: ProspectDomain[] = [];
    for (const c of candidates) {
      if (filtered.length >= maxProspects) break;
      if (ownDomain && c.domain === ownDomain) continue;
      if (isBlockedProspectDomain(c.domain)) continue;
      const guestPostKey = `guest_post:${input.siteId}:${c.domain}`;
      if (seenKeys.has(guestPostKey)) continue;
      filtered.push(c);
    }
    ctx.log.info(
      { siteId: site.id, filtered: filtered.length, dropped: discovered - filtered.length },
      'prospect: post-filter survivors',
    );

    // 3. Enrich (capped — Apollo is the dominant per-prospect cost).
    let enriched = 0;
    let rowsCreated = 0;
    let rowsRejected = 0;
    let rowsSent = 0;
    const pitchTopic = `Guide to ${site.niche} for homeowners in ${site.city}`;

    for (const c of filtered) {
      // Apollo cap stops further reveals — but we still queue *unenriched*
      // rows below so the operator can do manual editor lookup.
      const apolloBudgetRemaining = enriched < maxApolloEnrichments;

      let editor: Awaited<ReturnType<typeof findEditorByDomain>> = null;
      let apolloError: string | null = null;
      if (apolloBudgetRemaining) {
        try {
          editor = await findEditorByDomain(c.domain);
        } catch (err) {
          apolloError = err instanceof Error ? err.message : String(err);
          ctx.log.warn(
            { domain: c.domain, err: apolloError },
            'prospect: Apollo enrichment failed — queueing for manual editor lookup',
          );
        }
      }

      // Mask check: Apollo lower tiers return placeholder emails.
      const rawEmail = editor?.person.email?.toLowerCase() ?? '';
      const usableEmail =
        editor?.person.email &&
        !rawEmail.includes('email_not_unlocked') &&
        !rawEmail.includes('domain.com')
          ? editor.person.email
          : null;

      if (editor && usableEmail) {
        enriched += 1;
      }

      // Path A — Apollo found a usable editor: route through existing
      // runGuestPost which drafts the pitch and queues (or sends).
      if (editor && usableEmail) {
        const guestPostInput: Extract<BacklinkBuilderInput, { mode: 'guest_post' }> = {
          mode: 'guest_post',
          siteId: input.siteId,
          targetDomain: c.domain,
          targetEditorEmail: usableEmail,
          pitchTopic,
        };

        const extraMetadata = {
          prospect: {
            run: true,
            dfsRank: c.rank,
            referringDomainsToCompetitors: c.referringDomains,
            backlinksCount: c.backlinksCount,
            firstSeen: c.firstSeen,
            editorTitle: editor.person.title ?? null,
            editorEmailStatus: editor.person.email_status ?? null,
            apolloOrgId: editor.org.id ?? null,
            apolloPersonId: editor.person.id ?? null,
            niche: site.niche,
            minDomainRank: minRank,
            seeds,
          },
        };

        try {
          const result = await this.runGuestPost(guestPostInput, site, ctx, {
            queueOnly: !autoSend,
            extraMetadata,
          });
          rowsCreated += result.rowsCreated;
          rowsRejected += result.rowsRejected;
          rowsSent += result.rowsSent;
        } catch (err) {
          ctx.log.warn(
            { domain: c.domain, err: err instanceof Error ? err.message : String(err) },
            'prospect: guest_post sub-run failed',
          );
        }
        continue;
      }

      // Path B — Apollo had no usable record (404, masked email, no people,
      // or Apollo budget exhausted). Queue the prospect for manual editor
      // lookup so the operator can fill in `targetEditorEmail` via Hunter,
      // LinkedIn, or the site's contact page. No pitch draft yet — that
      // happens once the operator supplies the email.
      const manualDedupeKey = `prospect:${input.siteId}:${c.domain}`;
      const seenAlready = (
        await getDb()
          .select({ id: backlinks.id })
          .from(backlinks)
          .where(eq(backlinks.dedupeKey, manualDedupeKey))
      ).length > 0;
      if (seenAlready) continue;

      try {
        await getDb()
          .insert(backlinks)
          .values({
            siteId: input.siteId,
            sourceDomain: c.domain,
            targetUrl: null,
            type: 'guest_post',
            status: 'pending',
            dedupeKey: manualDedupeKey,
            pitchDraft: null,
            subjectLine: null,
            rejectionReason: null,
            metadata: {
              targetEditorEmail: null,
              pitchTopic,
              prospect: {
                run: true,
                dfsRank: c.rank,
                referringDomainsToCompetitors: c.referringDomains,
                backlinksCount: c.backlinksCount,
                firstSeen: c.firstSeen,
                editorTitle: null,
                editorEmailStatus: null,
                apolloOrgId: editor?.org.id ?? null,
                apolloPersonId: null,
                niche: site.niche,
                minDomainRank: minRank,
                seeds,
                needsManualEditor: true,
                apolloError,
                apolloBudgetExhausted: !apolloBudgetRemaining,
              },
            },
          })
          .onConflictDoNothing({
          target: backlinks.dedupeKey,
          where: sql`${backlinks.dedupeKey} IS NOT NULL`,
        });
        rowsCreated += 1;
      } catch (err) {
        ctx.log.warn(
          { domain: c.domain, err: err instanceof Error ? err.message : String(err) },
          'prospect: manual-lookup row insert failed',
        );
      }
    }

    ctx.log.info(
      { siteId: site.id, discovered, enriched, rowsCreated, rowsRejected, rowsSent },
      'prospect: run complete',
    );
    return {
      mode: 'prospect',
      siteId: input.siteId,
      rowsCreated,
      rowsRejected,
      rowsSent,
      prospectsDiscovered: discovered,
      prospectsEnriched: enriched,
    };
  }
}

/**
 * Stable 8-char hash for dedupe keys. Not cryptographic — just a fast
 * collision-resistant tag so different competitor seed sets dedupe
 * independently within the same (site, day) bucket.
 */
function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Count Apollo person-reveals consumed this calendar month, by scanning
 * `backlinks` rows whose metadata carries a prospect.apolloPersonId.
 * Each such row represents exactly one successful findEditorByDomain call.
 * Used by runProspect to gate against the Apollo monthly cap (free tier 75).
 */
async function countApolloEnrichmentsThisMonth(): Promise<number> {
  const db = getDb();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rows = await db
    .select({ metadata: backlinks.metadata, createdAt: backlinks.createdAt })
    .from(backlinks);
  let count = 0;
  for (const r of rows) {
    if (!r.createdAt || new Date(r.createdAt) < monthStart) continue;
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    const p = md.prospect as Record<string, unknown> | undefined;
    if (p && p.apolloPersonId) count += 1;
  }
  return count;
}

/**
 * Standalone guest-post draft helper. Same prompt as the agent's internal
 * `draftGuestPostEmail`, but callable from the operator UI when an
 * operator manually supplies an editor email for a manual-lookup row.
 * No agent context — usage is tracked at call site if needed.
 */
export async function draftGuestPostPitch(args: {
  targetDomain: string;
  pitchTopic: string;
  niche: string;
  city: string;
  state: string;
}): Promise<{ subject: string; body: string }> {
  const client = getAnthropicClient();
  const model = process.env.BACKLINK_BUILDER_MODEL ?? 'claude-haiku-4-5';
  const postalAddress =
    process.env.LEADLANDLORD_POSTAL_ADDRESS
    ?? `LeadLandlord, [postal address not set], ${args.city}, ${args.state}`;
  const userPrompt = `Draft a short, sincere guest-post pitch email to the editor of ${args.targetDomain}.

Sender: a ${args.niche} business in ${args.city}, ${args.state}.
Pitch topic: ${args.pitchTopic}

Constraints:
- Subject line: <= 60 chars, specific.
- Body: ~120 words, plain text.
- Suggest 2 concrete article angles relevant to ${args.targetDomain}'s audience.
- Include an unsubscribe line: "Reply with REMOVE if you'd rather not hear from me again."
- Include a postal address line on its own line: "${postalAddress}".
- Sign off "— ${args.niche} team in ${args.city}".
- No fake credentials, no superlatives.

Return strictly JSON: {"subject": "...", "body": "..."}.`;

  const response = await client.messages.create({
    model,
    max_tokens: 800,
    temperature: 0.5,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    const parsed = JSON.parse(cleaned) as { subject?: unknown; body?: unknown };
    if (typeof parsed.subject === 'string' && typeof parsed.body === 'string') {
      return { subject: parsed.subject, body: parsed.body };
    }
  } catch {
    // fall through to fallback
  }
  return {
    subject: `Guest post idea for ${args.targetDomain}`,
    body: [
      `Hi,`,
      ``,
      `I run a ${args.niche} business in ${args.city}, ${args.state} and put together a quick angle on "${args.pitchTopic}" that I think would land with your readers.`,
      ``,
      `Happy to send a 700-word draft if you're open to a contributor piece.`,
      ``,
      `Reply with REMOVE if you'd rather not hear from me again.`,
      ``,
      `— ${args.niche} team in ${args.city}`,
      postalAddress,
    ].join('\n'),
  };
}

// Re-export for tests / external introspection.
export { CITATION_DIRECTORIES } from './directories';
