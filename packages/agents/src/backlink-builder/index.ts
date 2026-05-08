import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getDb, backlinks, sites, type Site } from '@leadlandlord/db';
import { sendEmail } from '@leadlandlord/integrations/resend';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
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
]);

export type BacklinkBuilderInput = z.infer<typeof BacklinkBuilderInput>;

export const BacklinkBuilderOutput = z.object({
  mode: z.enum(['citations', 'haro', 'guest_post']),
  siteId: z.string().uuid(),
  rowsCreated: z.number(),
  rowsRejected: z.number(),
  rowsSent: z.number(),
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
          .onConflictDoNothing({ target: backlinks.dedupeKey })
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
        .onConflictDoNothing({ target: backlinks.dedupeKey })
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
  ): Promise<BacklinkBuilderOutput> {
    const db = getDb();
    const dedupeKey = `guest_post:${input.siteId}:${input.targetDomain.toLowerCase()}`;

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
          },
        })
        .onConflictDoNothing({ target: backlinks.dedupeKey });
      return {
        mode: 'guest_post',
        siteId: input.siteId,
        rowsCreated: 0,
        rowsRejected: 1,
        rowsSent: 0,
      };
    }

    // Send via Resend, mirroring outreach-agent's email path.
    let externalId: string | undefined;
    let sendError: string | undefined;
    try {
      const from = process.env.RESEND_FROM_ADDRESS;
      if (!from) throw new Error('RESEND_FROM_ADDRESS not set');
      const res = await sendEmail({
        to: input.targetEditorEmail,
        from,
        subject,
        text: body,
      });
      externalId = res.messageId;
    } catch (err) {
      sendError = err instanceof Error ? err.message : String(err);
      ctx.log.error({ err: sendError, targetDomain: input.targetDomain }, 'guest_post send failed');
    }

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
        },
      })
      .onConflictDoNothing({ target: backlinks.dedupeKey });

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
    const userPrompt = `Draft a short, sincere guest-post pitch email to the editor of ${input.targetDomain}.

Sender: a ${site.niche} business in ${site.city}, ${site.state}.
Pitch topic: ${input.pitchTopic}

Constraints:
- Subject line: <= 60 chars, specific.
- Body: ~120 words, plain text.
- Suggest 2 concrete article angles relevant to ${input.targetDomain}'s audience.
- Include an unsubscribe line: "Reply with REMOVE if you'd rather not hear from me again."
- Include a postal address line on its own line: "LeadLandlord, PO Box 0000, ${site.city}, ${site.state} 00000".
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
        `LeadLandlord, PO Box 0000, ${site.city}, ${site.state} 00000`,
      ].join('\n'),
    };
  }
}

// Re-export for tests / external introspection.
export { CITATION_DIRECTORIES } from './directories';
