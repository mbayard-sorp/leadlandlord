import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { getDb, backlinks, backlinkProspects, sites, type Site } from '@leadlandlord/db';
import { sendEmail as sendEmailResend } from '@leadlandlord/integrations/resend';
import { sendEmail as sendEmailZoho, sendReply as sendReplyZoho } from '@leadlandlord/integrations/zoho-mcp';
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
import { MOLLY_PERSONA } from '../molly/persona';
import { decideBcc, recordBccSend } from '../molly/bcc';

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
  z.object({
    /**
     * Operator-driven path: an operator approved a Molly top-5 pick. We
     * load the prospect row, resolve editor email (prospect metadata or
     * fresh Apollo lookup), derive pitchTopic, and dispatch through the
     * existing runGuestPost pipeline. On success the prospect row is
     * advanced to status='pitched' with backlink_id wired in.
     */
    mode: z.literal('prospect_approved'),
    siteId: z.string().uuid(),
    prospectId: z.string().uuid(),
  }),
  z.object({
    /**
     * Day-N follow-up nudge for an unanswered guest_post pitch. The MollyNudge
     * scheduler emits one event per qualifying backlink; this mode drafts a
     * short Molly-voice follow-up, sends it via Zoho `sendReplyEmail` so it
     * threads with the original pitch in the editor's inbox, and bumps
     * `backlinks.nudge_count` / `last_nudge_at`. BCC graduation still applies.
     */
    mode: z.literal('nudge'),
    siteId: z.string().uuid(),
    backlinkId: z.string().uuid(),
    /**
     * Current `backlinks.nudge_count` at the moment the scheduler chose this
     * row. Included so the agent-run dedupe key is `nudge:<id>:<n>` —
     * unique per cadence step, never "permanently cached." The agent
     * re-reads the live count inside execute() and bails if it has since
     * advanced (concurrent scheduler tick already nudged this row).
     */
    expectedNudgeCount: z.number().int().min(0).max(7),
  }),
]);

export type BacklinkBuilderInput = z.infer<typeof BacklinkBuilderInput>;

export const BacklinkBuilderOutput = z.object({
  mode: z.enum(['citations', 'haro', 'guest_post', 'prospect', 'prospect_approved', 'nudge']),
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
          case 'prospect_approved':
            // Dedupe at the event level. The underlying runGuestPost call
            // still produces its own `guest_post:${siteId}:${domain}` key on
            // the backlinks row, so a duplicate prospect_approved event
            // collapses to a no-op via the backlinks dedupe_key index.
            return `prospect_approved:${i.siteId}:${i.prospectId}`;
          case 'nudge':
            // Dedupe per (backlinkId, nudge step). expectedNudgeCount is the
            // count the scheduler observed; agent_runs uniqueness on
            // (agent, dedupe_key) WHERE status='succeeded' means a duplicate
            // event for the same step short-circuits to the cached output
            // (no extra send), but the next cadence step has a fresh key.
            return `nudge:${i.backlinkId}:${i.expectedNudgeCount}`;
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
      case 'prospect_approved':
        return this.runProspectApproved(input, site, ctx);
      case 'nudge':
        return this.runNudge(input, site, ctx);
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
    opts?: {
      queueOnly?: boolean;
      extraMetadata?: Record<string, unknown>;
      dedupeKey?: string;
      /**
       * Invoked once the success-path `backlinks` row is inserted (after a
       * successful send). Receives the new row id so callers can wire
       * downstream rows (e.g. `backlink_prospects.backlink_id`). Not called
       * on conflict-skip, throttle, queueOnly, compliance-block, or send error.
       */
      onSubmitted?: (backlinkId: string, externalId: string) => Promise<void>;
    },
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
    const useMolly = process.env.ZOHO_MOLLY_ENABLED === 'true';
    // Molly's mailbox is isolated from the generic mailbox so the per-mailbox
    // throttle in email_sends tracks her sends separately from any other sender.
    const mailbox = useMolly
      ? (process.env.ZOHO_MOLLY_FROM ?? MOLLY_PERSONA.mailbox)
      : useZoho
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

    // BCC graduation policy (R4.3). Molly's first 20 globally-outbound
    // sends are BCC'd to a human reviewer so we can spot-check tone before
    // the agent runs unsupervised. After graduation BCC stops unless the
    // operator flips manual_override in the UI. Non-Molly sends never BCC.
    const bccDecision = useMolly ? await decideBcc('molly') : null;
    const bcc = bccDecision?.bcc ?? undefined;

    // Send.
    let externalId: string | undefined;
    let sendError: string | undefined;
    // When Molly is active, encode the display name in the From field using
    // RFC 5322 "Display Name <addr>" format. Zoho Mail accepts this in the
    // fromAddress parameter. When the flag is off the mailbox string is used
    // as-is (no display name), which matches the existing behavior.
    const fromField = useMolly
      ? `${MOLLY_PERSONA.displayName} <${mailbox}>`
      : mailbox;
    try {
      if (useZoho || useMolly) {
        const res = await sendEmailZoho({
          to: input.targetEditorEmail,
          from: fromField,
          subject,
          text: body,
          ...(bcc ? { bcc } : {}),
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
      provider: (useZoho || useMolly) ? 'zoho' : 'resend',
      externalId: externalId ?? null,
      status: sendError ? 'failed' : 'sent',
      errorMessage: sendError ?? null,
      metadata: bcc ? { bcc } : undefined,
    });

    // Advance the BCC graduation counter only after a confirmed successful
    // send. Failed sends, throttle skips, and queueOnly drafts do not count.
    if (useMolly && !sendError) {
      try {
        await recordBccSend('molly');
      } catch (err) {
        ctx.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'guest_post: BCC graduation counter update failed (send already succeeded)',
        );
      }
    }

    const status = sendError ? 'pending' : 'submitted';
    const inserted = await db
      .insert(backlinks)
      .values({
        siteId: input.siteId,
        sourceDomain: input.targetDomain.toLowerCase(),
        targetUrl: null,
        type: 'guest_post',
        status,
        dedupeKey,
        // R4.2 added a top-level `message_id` column for inbox correlation;
        // store the provider id there in addition to metadata so MollyInbox
        // can filter replies by In-Reply-To without a JSONB scan.
        messageId: externalId ?? null,
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
        })
      .returning({ id: backlinks.id });

    if (!sendError && externalId && opts?.onSubmitted && inserted[0]?.id) {
      try {
        await opts.onSubmitted(inserted[0].id, externalId);
      } catch (err) {
        ctx.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'guest_post: onSubmitted callback failed (send already succeeded)',
        );
      }
    }

    return {
      mode: 'guest_post',
      siteId: input.siteId,
      rowsCreated: sendError ? 1 : 0,
      rowsRejected: 0,
      rowsSent: sendError ? 0 : 1,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Prospect approved (operator-triggered guest_post)
  // ────────────────────────────────────────────────────────────

  /**
   * Handle the `prospect.approved` event emitted by the operator UI when
   * a Molly top-5 pick is approved. Loads the prospect, resolves an editor
   * email (prospect metadata first, then a fresh Apollo lookup as fallback),
   * derives a default pitchTopic, dispatches the existing runGuestPost
   * pipeline, and on success advances the prospect row to status='pitched'
   * with its backlink_id wired.
   *
   * Idempotency: the event-level dedupeKey is `prospect_approved:<siteId>:<prospectId>`.
   * Re-runs after a successful pitch are no-ops because the prospect status
   * has moved past `approved`. The underlying backlinks insert dedupes on
   * `guest_post:<siteId>:<domain>`.
   */
  private async runProspectApproved(
    input: Extract<BacklinkBuilderInput, { mode: 'prospect_approved' }>,
    site: Site,
    ctx: AgentContext,
  ): Promise<BacklinkBuilderOutput> {
    const db = getDb();
    const prospect = (
      await db
        .select()
        .from(backlinkProspects)
        .where(eq(backlinkProspects.id, input.prospectId))
        .limit(1)
    )[0];

    if (!prospect) {
      ctx.log.warn({ prospectId: input.prospectId }, 'prospect_approved: prospect not found');
      return {
        mode: 'prospect_approved',
        siteId: input.siteId,
        rowsCreated: 0,
        rowsRejected: 0,
        rowsSent: 0,
      };
    }

    if (prospect.status !== 'approved') {
      ctx.log.info(
        { prospectId: prospect.id, status: prospect.status },
        'prospect_approved: skipping — prospect not in approved status',
      );
      return {
        mode: 'prospect_approved',
        siteId: input.siteId,
        rowsCreated: 0,
        rowsRejected: 0,
        rowsSent: 0,
      };
    }

    // Resolve editor email. Prefer cached value on the prospect row; fall
    // back to a fresh Apollo lookup. If both fail, mark the prospect
    // back to approved (no-op) and let the operator supply an email later.
    const metadata = (prospect.metadata ?? {}) as Record<string, unknown>;
    const cachedEmail = typeof metadata.editorEmail === 'string' ? metadata.editorEmail : null;

    let editorEmail = cachedEmail;
    if (!editorEmail) {
      try {
        const editor = await findEditorByDomain(prospect.domain);
        const raw = editor?.person.email?.toLowerCase() ?? '';
        const usable =
          editor?.person.email &&
          !raw.includes('email_not_unlocked') &&
          !raw.includes('domain.com')
            ? editor.person.email
            : null;
        editorEmail = usable;
      } catch (err) {
        ctx.log.warn(
          {
            prospectId: prospect.id,
            domain: prospect.domain,
            err: err instanceof Error ? err.message : String(err),
          },
          'prospect_approved: Apollo lookup failed',
        );
      }
    }

    if (!editorEmail) {
      ctx.log.warn(
        { prospectId: prospect.id, domain: prospect.domain },
        'prospect_approved: no editor email available — leaving prospect in approved state for manual intervention',
      );
      return {
        mode: 'prospect_approved',
        siteId: input.siteId,
        rowsCreated: 0,
        rowsRejected: 0,
        rowsSent: 0,
      };
    }

    const pitchTopic = `Guide to ${site.niche} for homeowners in ${site.city}`;

    const guestPostInput: Extract<BacklinkBuilderInput, { mode: 'guest_post' }> = {
      mode: 'guest_post',
      siteId: input.siteId,
      targetDomain: prospect.domain,
      targetEditorEmail: editorEmail,
      pitchTopic,
    };

    const result = await this.runGuestPost(guestPostInput, site, ctx, {
      extraMetadata: { prospectId: prospect.id },
      onSubmitted: async (backlinkId) => {
        await db
          .update(backlinkProspects)
          .set({
            status: 'pitched',
            backlinkId,
            updatedAt: new Date(),
          })
          .where(eq(backlinkProspects.id, prospect.id));
      },
    });

    return {
      mode: 'prospect_approved',
      siteId: input.siteId,
      rowsCreated: result.rowsCreated,
      rowsRejected: result.rowsRejected,
      rowsSent: result.rowsSent,
    };
  }

  // ────────────────────────────────────────────────────────────
  // Nudge (day-N follow-up on an unanswered guest_post pitch)
  // ────────────────────────────────────────────────────────────

  /**
   * Day-N follow-up nudge. Loads the existing backlink, drafts a 60–80 word
   * follow-up in Molly's voice using the original pitch as anchoring context,
   * sends via Zoho `sendReplyEmail` so it threads with the original outbound
   * message, and bumps nudge_count / last_nudge_at.
   *
   * Guards:
   *   - Skips if the backlink is no longer in {submitted, awaiting_reply}.
   *   - Skips if the persisted nudge_count has advanced past the count the
   *     scheduler observed (another tick already nudged this row).
   *   - Skips if nudge_count is already >= 7 (final nudge already sent).
   *   - Skips if the backlink has no `message_id` (no parent to thread to).
   */
  private async runNudge(
    input: Extract<BacklinkBuilderInput, { mode: 'nudge' }>,
    site: Site,
    ctx: AgentContext,
  ): Promise<BacklinkBuilderOutput> {
    const db = getDb();
    const row = (
      await db.select().from(backlinks).where(eq(backlinks.id, input.backlinkId)).limit(1)
    )[0];

    const empty: BacklinkBuilderOutput = {
      mode: 'nudge',
      siteId: input.siteId,
      rowsCreated: 0,
      rowsRejected: 0,
      rowsSent: 0,
    };

    if (!row) {
      ctx.log.warn({ backlinkId: input.backlinkId }, 'nudge: backlink not found');
      return empty;
    }
    if (row.type !== 'guest_post') {
      ctx.log.info({ backlinkId: row.id, type: row.type }, 'nudge: not a guest_post row, skipping');
      return empty;
    }
    if (row.status !== 'submitted' && row.status !== 'awaiting_reply') {
      ctx.log.info({ backlinkId: row.id, status: row.status }, 'nudge: not in submitted/awaiting_reply, skipping');
      return empty;
    }
    if (row.nudgeCount !== input.expectedNudgeCount) {
      ctx.log.info(
        { backlinkId: row.id, expected: input.expectedNudgeCount, actual: row.nudgeCount },
        'nudge: count advanced — another tick already nudged this row',
      );
      return empty;
    }
    if (row.nudgeCount >= 7) {
      ctx.log.info({ backlinkId: row.id }, 'nudge: cadence cap reached, skipping');
      return empty;
    }
    if (!row.messageId) {
      ctx.log.warn({ backlinkId: row.id }, 'nudge: no parent message_id, cannot thread');
      return empty;
    }

    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const targetEditorEmail = typeof metadata.targetEditorEmail === 'string' ? metadata.targetEditorEmail : null;
    if (!targetEditorEmail) {
      ctx.log.warn({ backlinkId: row.id }, 'nudge: no targetEditorEmail in metadata, skipping');
      return empty;
    }

    // Provider + persona — must mirror runGuestPost's logic so nudges align
    // with the initial pitch's voice and BCC graduation policy.
    const useMolly = process.env.ZOHO_MOLLY_ENABLED === 'true';
    if (!useMolly) {
      ctx.log.info({ backlinkId: row.id }, 'nudge: ZOHO_MOLLY_ENABLED not set, skipping');
      return empty;
    }
    const mailbox = process.env.ZOHO_MOLLY_FROM ?? MOLLY_PERSONA.mailbox;
    const fromField = `${MOLLY_PERSONA.displayName} <${mailbox}>`;

    // Throttle (per-mailbox daily cap).
    const { remaining } = await getRemainingSendsToday(mailbox);
    if (remaining <= 0) {
      ctx.log.info({ backlinkId: row.id, mailbox }, 'nudge: daily cap reached, skipping');
      return empty;
    }

    const stepNumber = row.nudgeCount + 1; // 1-indexed for prompts/subjects
    const draft = await this.draftNudgeEmail(
      {
        site,
        targetDomain: row.sourceDomain,
        originalSubject: row.subjectLine ?? `guest post for ${row.sourceDomain}`,
        originalBody: row.pitchDraft ?? '',
        stepNumber,
      },
      ctx,
    );
    const subject = row.subjectLine?.toLowerCase().startsWith('re:')
      ? row.subjectLine
      : `Re: ${row.subjectLine ?? `Guest post idea for ${row.sourceDomain}`}`;

    // BCC graduation still applies. The counter is global per agent so nudges
    // count toward the same 20-send graduation budget as initial pitches.
    const bccDecision = await decideBcc('molly');
    const bcc = bccDecision?.bcc ?? undefined;

    let externalId: string | undefined;
    let sendError: string | undefined;
    try {
      const res = await sendReplyZoho({
        inReplyToMessageId: row.messageId,
        to: targetEditorEmail,
        from: fromField,
        subject,
        text: draft,
        ...(bcc ? { bcc } : {}),
      });
      externalId = res.messageId;
    } catch (err) {
      sendError = err instanceof Error ? err.message : String(err);
      ctx.log.error({ backlinkId: row.id, err: sendError }, 'nudge: send failed');
    }

    await recordSend({
      siteId: input.siteId,
      mailbox,
      toAddress: targetEditorEmail,
      subject,
      purpose: 'guest_post',
      provider: 'zoho',
      externalId: externalId ?? null,
      status: sendError ? 'failed' : 'sent',
      errorMessage: sendError ?? null,
      metadata: {
        nudge: { backlinkId: row.id, step: stepNumber },
        ...(bcc ? { bcc } : {}),
      },
    });

    if (sendError) {
      return { ...empty, rowsCreated: 0 };
    }

    try {
      await recordBccSend('molly');
    } catch (err) {
      ctx.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'nudge: BCC graduation counter update failed (send already succeeded)',
      );
    }

    const nudgeHistory = Array.isArray(metadata.nudgeHistory) ? (metadata.nudgeHistory as unknown[]) : [];
    await db
      .update(backlinks)
      .set({
        nudgeCount: stepNumber,
        lastNudgeAt: new Date(),
        // Promote `submitted` → `awaiting_reply` on the first nudge so the
        // operator UI can distinguish "we sent the pitch" from "we sent the
        // pitch and started chasing." Subsequent nudges leave status alone.
        status: row.status === 'submitted' ? 'awaiting_reply' : row.status,
        metadata: {
          ...metadata,
          nudgeHistory: [
            ...nudgeHistory,
            {
              step: stepNumber,
              externalId,
              sentAt: new Date().toISOString(),
            },
          ].slice(-20),
        },
      })
      .where(eq(backlinks.id, row.id));

    ctx.log.info(
      { backlinkId: row.id, step: stepNumber, externalId },
      'nudge: sent',
    );

    return { ...empty, rowsSent: 1 };
  }

  private async draftNudgeEmail(
    args: {
      site: Site;
      targetDomain: string;
      originalSubject: string;
      originalBody: string;
      stepNumber: number;
    },
    ctx: AgentContext,
  ): Promise<string> {
    const client = getAnthropicClient();
    const model = process.env.BACKLINK_BUILDER_MODEL ?? 'claude-haiku-4-5';

    const userPrompt = `Write nudge #${args.stepNumber} (a brief follow-up) to an unanswered guest-post pitch you (Molly) sent to the editor of ${args.targetDomain}.

Original subject: ${args.originalSubject}
Original pitch:
"""
${args.originalBody.slice(0, 1200)}
"""

Constraints:
- 60-80 words MAX. Plain text only.
- Do NOT repeat the original pitch verbatim. Reference it briefly.
- For nudge 1-2, offer to adjust the angle or word count.
- For nudge 3-4, briefly offer one different angle.
- For nudge 5+, say this is your last check-in and you will not follow up again.
- Unsubscribe line (exact text): "Reply REMOVE if you'd rather not hear from me."
- Signature (exact text, final line): "${MOLLY_PERSONA.signatureLine}"
- No subject line in the output — only the body.

Return only the body as plain text, no JSON wrapper.`;

    const response = await client.messages.create({
      model,
      max_tokens: 350,
      temperature: 0.5,
      system: MOLLY_PERSONA.voiceSystemPrompt,
      messages: [
        ...MOLLY_PERSONA.fewShot.flatMap((ex) => [
          { role: 'user' as const, content: ex.userMsg },
          { role: 'assistant' as const, content: ex.assistantMsg },
        ]),
        { role: 'user' as const, content: userPrompt },
      ],
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

    if (text.length > 0) return text;

    // Fallback when Claude returned nothing useful.
    return [
      `Hi,`,
      ``,
      `Just bumping this in case it got buried. Happy to adjust the angle or word count if that helps it fit better.`,
      ``,
      `Reply REMOVE if you'd rather not hear from me.`,
      ``,
      MOLLY_PERSONA.signatureLine,
    ].join('\n');
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
    const useMolly = process.env.ZOHO_MOLLY_ENABLED === 'true';

    const userPrompt = useMolly
      ? `Draft a short, sincere guest-post pitch email to the editor of ${input.targetDomain}.

You are writing as Molly Matthews, Sr. Outreach Manager at LeadLandlord.
The business you are pitching on behalf of: a ${site.niche} business in ${site.city}, ${site.state}.
Pitch topic: ${input.pitchTopic}

Constraints:
- Subject line: <= 60 chars, specific to the pitch angle.
- Body: 100-130 words, plain text only.
- Opening line must reference a specific recent post or topic from ${input.targetDomain} — if you do not know one, say "I have been following your site" rather than fabricating a post title.
- Suggest 1-2 concrete article angles relevant to ${input.targetDomain}'s audience.
- Unsubscribe line (required, exact text): "Reply REMOVE if you'd rather not hear from me."
- Postal address line (required, on its own line): "${postalAddress}"
- Signature (required, exact text, last line of body): "${MOLLY_PERSONA.signatureLine}"
- No fake credentials, no superlatives, no marketing buzzwords.
- Write as "I" (Molly speaking), not as "we" or a team.

Return strictly JSON: {"subject": "...", "body": "..."}.`
      : `Draft a short, sincere guest-post pitch email to the editor of ${input.targetDomain}.

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

    // When Molly is active, prepend her voice system prompt and inject few-shot
    // examples. The system prompt encodes tone rules; the few-shots show Claude
    // what Molly's output actually looks like for concrete scenarios.
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = useMolly
      ? [
          ...MOLLY_PERSONA.fewShot.flatMap((ex) => [
            { role: 'user' as const, content: ex.userMsg },
            { role: 'assistant' as const, content: ex.assistantMsg },
          ]),
          { role: 'user', content: userPrompt },
        ]
      : [{ role: 'user', content: userPrompt }];

    const response = await client.messages.create({
      model,
      max_tokens: 800,
      temperature: 0.5,
      ...(useMolly ? { system: MOLLY_PERSONA.voiceSystemPrompt } : {}),
      messages,
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
    const fallbackSignoff = useMolly
      ? [
          `Reply REMOVE if you'd rather not hear from me.`,
          ``,
          MOLLY_PERSONA.signatureLine,
          postalAddress,
        ]
      : [
          `Reply with REMOVE if you'd rather not hear from me again.`,
          ``,
          `— ${site.niche} team in ${site.city}`,
          postalAddress,
        ];
    return {
      subject: `Guest post idea for ${input.targetDomain}`,
      body: [
        `Hi,`,
        ``,
        `I run outreach for a ${site.niche} business in ${site.city}, ${site.state} and put together a quick angle on "${input.pitchTopic}" that I think would land with your readers.`,
        ``,
        `Happy to send a 900-word draft if you're open to a contributor piece.`,
        ``,
        ...fallbackSignoff,
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
