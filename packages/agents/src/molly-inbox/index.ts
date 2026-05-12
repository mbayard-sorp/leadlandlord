import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, agentRuns, backlinks } from '@leadlandlord/db';
import { listMessages, getMessage } from '@leadlandlord/integrations/zoho-mcp';
import { BaseAgent, type AgentContext } from '../base';
import { classifyReply, type ReplyClassification, type ReplyLabel } from './classifier';

/**
 * MollyInbox — poll Molly's mailbox, correlate inbound replies to outbound
 * pitches via `In-Reply-To` ↔ `backlinks.message_id`, classify, and transition
 * `backlinks.status` into the reply state machine (ADR-0006).
 *
 * State transitions handled here:
 *   submitted | awaiting_reply  → reply_received → (accepted | declined | silent | escalated)
 *
 * Terminal states (`accepted`, `declined`, `escalated`, `published`, `verified`,
 * `dormant`, `lost`, `manual_review`) are never overwritten — re-processing
 * the same inbound message is a no-op.
 *
 * High-water mark: each successful run records `lastSeenAt` in its output.
 * The next run reads the most recent successful `molly-inbox` run's
 * `output.lastSeenAt` to set the `since` filter. Falls back to 7d ago when
 * no prior run exists. This avoids any new schema column.
 *
 * Idempotency:
 *   - Run-level dedupe key is the 15-minute clock bucket so a duplicate cron
 *     tick collapses.
 *   - Per-message: we check the current `backlinks.status` before writing.
 *     Terminal statuses short-circuit. Same `messageId` re-fetched in a later
 *     run produces the same regex/Haiku label, and the no-op-on-terminal
 *     guard makes that a write-skip.
 */

const MollyInboxInput = z.object({
  /** ISO timestamp override — testing only. Production leaves this undefined
   *  and the agent derives `since` from its prior run. */
  since: z.string().datetime().optional(),
  /** Maximum messages to pull per run. Default 50, cap 200. */
  limit: z.number().int().min(1).max(200).optional(),
  /** Override folder id. Falls back to env `ZOHO_MOLLY_INBOX_FOLDER_ID`. */
  folderId: z.string().optional(),
});

const TransitionRecord = z.object({
  backlinkId: z.string().uuid(),
  messageId: z.string(),
  inReplyTo: z.string(),
  fromStatus: z.string(),
  toStatus: z.enum(['reply_received', 'accepted', 'declined', 'silent', 'escalated']),
  classification: z.object({
    label: z.enum(['accepted', 'declined', 'silent', 'escalated']),
    confidence: z.number(),
    source: z.enum(['regex', 'haiku']),
    reason: z.string(),
  }),
});

const MollyInboxOutput = z.object({
  scanned: z.number(),
  matched: z.number(),
  transitions: z.array(TransitionRecord),
  /** ISO of the most recent message we processed; advances the high-water mark. */
  lastSeenAt: z.string().nullable(),
  /** Window start used by this run (informational). */
  sinceUsed: z.string(),
});

type MollyInboxInput = z.infer<typeof MollyInboxInput>;
type MollyInboxOutput = z.infer<typeof MollyInboxOutput>;

const TERMINAL_STATUSES = new Set<string>([
  'accepted',
  'declined',
  'escalated',
  'published',
  'verified',
  'dormant',
  'lost',
  'manual_review',
  'rejected',
]);

const CORRELATABLE_STATUSES = ['submitted', 'awaiting_reply'] as const;

/** Map classifier label → backlinks.status enum value. */
function labelToStatus(label: ReplyLabel): 'accepted' | 'declined' | 'silent' | 'escalated' {
  return label;
}

export class MollyInbox extends BaseAgent<typeof MollyInboxInput, typeof MollyInboxOutput> {
  constructor() {
    super({
      name: 'molly-inbox',
      inputSchema: MollyInboxInput,
      outputSchema: MollyInboxOutput,
      // 15-minute bucket so duplicate cron ticks collapse. Caller-supplied
      // `since` overrides bucket to that timestamp so manual replays can be
      // re-run without the dedupe blocking them.
      dedupeKeyFn: (input) => {
        if (input.since) return `molly-inbox:replay:${input.since}`;
        const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
        return `molly-inbox:bucket:${bucket}`;
      },
      defaultDailyCapUsd: 2,
    });
  }

  protected async execute(input: MollyInboxInput, ctx: AgentContext): Promise<MollyInboxOutput> {
    const db = getDb();

    // Derive high-water mark.
    const since = input.since ?? (await loadPriorLastSeenAt()) ?? defaultSinceIso();
    const limit = input.limit ?? 50;

    let scanned = 0;
    let matched = 0;
    const transitions: MollyInboxOutput['transitions'] = [];
    let lastSeenAt: string | null = null;

    // 1. Pull recent messages.
    const messages = await listMessages({
      since,
      ...(input.folderId ? { folderId: input.folderId } : {}),
      limit,
    });
    scanned = messages.length;
    ctx.log.info({ since, scanned }, 'molly-inbox: messages pulled');

    // Order oldest → newest so the high-water mark is the most recent successful processing.
    const ordered = [...messages].sort((a, b) => {
      const ta = a.receivedAt ? Date.parse(a.receivedAt) : 0;
      const tb = b.receivedAt ? Date.parse(b.receivedAt) : 0;
      return ta - tb;
    });

    for (const m of ordered) {
      try {
        // 2. Fetch full message + headers.
        const full = await getMessage(m.messageId);
        if (full.receivedAt) lastSeenAt = full.receivedAt;
        if (!full.inReplyTo) {
          ctx.log.debug({ messageId: m.messageId }, 'molly-inbox: no In-Reply-To, skipping');
          continue;
        }

        // 3. Correlate by In-Reply-To (and References as fallback).
        const candidateRefs = [full.inReplyTo, ...full.references];
        const rows = await db
          .select()
          .from(backlinks)
          .where(
            and(
              inArray(backlinks.messageId, candidateRefs),
              inArray(backlinks.status, [...CORRELATABLE_STATUSES, 'reply_received']),
            ),
          )
          .limit(1);
        const row = rows[0];
        if (!row) {
          ctx.log.debug(
            { messageId: m.messageId, inReplyTo: full.inReplyTo },
            'molly-inbox: no matching backlink',
          );
          continue;
        }
        matched += 1;

        // Terminal-state guard — should be impossible given the WHERE above,
        // but defense-in-depth in case the enum set drifts.
        if (TERMINAL_STATUSES.has(row.status)) {
          ctx.log.info(
            { backlinkId: row.id, status: row.status },
            'molly-inbox: backlink already terminal, skipping',
          );
          continue;
        }

        // 4. Classify.
        const replyText = full.replyOnlyBody ?? full.body;
        let classification: ReplyClassification;
        try {
          classification = await classifyReply({
            body: replyText,
            subject: full.subject,
            originalPitchSubject: row.subjectLine ?? undefined,
          });
        } catch (err) {
          ctx.log.warn(
            { err: err instanceof Error ? err.message : String(err), backlinkId: row.id },
            'molly-inbox: classifier failed, defaulting to manual review',
          );
          classification = {
            label: 'escalated',
            confidence: 0,
            source: 'haiku',
            reason: 'classifier_error',
            costUsd: 0,
          };
        }

        if (classification.source === 'haiku' && classification.costUsd > 0) {
          ctx.recordUsage({
            model: process.env.MOLLY_INBOX_MODEL ?? 'claude-haiku-4-5',
            input_tokens: 0,
            output_tokens: 0,
            cost_usd: classification.costUsd,
          });
        }

        // 5. Transition. We always move through `reply_received` on the audit
        //    trail by writing the terminal label directly — `reply_received`
        //    is an intermediate marker that other code can interpret as
        //    "reply seen but not yet classified". Since we classify inline,
        //    we go submitted/awaiting_reply → {accepted|declined|silent|escalated}.
        const toStatus = labelToStatus(classification.label);
        const snippet = replyText.replace(/\s+/g, ' ').trim().slice(0, 280);

        const existingMeta = (row.metadata ?? {}) as Record<string, unknown>;
        const replyLog = Array.isArray(existingMeta.replyLog)
          ? (existingMeta.replyLog as unknown[])
          : [];
        const newMeta = {
          ...existingMeta,
          lastReply: {
            messageId: full.messageId,
            inReplyTo: full.inReplyTo,
            fromAddress: full.fromAddress,
            receivedAt: full.receivedAt,
            classification: {
              label: classification.label,
              confidence: classification.confidence,
              source: classification.source,
              reason: classification.reason,
            },
          },
          replyLog: [
            ...replyLog,
            {
              messageId: full.messageId,
              receivedAt: full.receivedAt,
              label: classification.label,
              source: classification.source,
              reason: classification.reason,
            },
          ].slice(-20),
        };

        await db
          .update(backlinks)
          .set({
            status: toStatus,
            responseAt: full.receivedAt ? new Date(full.receivedAt) : new Date(),
            responseSnippet: snippet,
            metadata: newMeta,
          })
          .where(eq(backlinks.id, row.id));

        transitions.push({
          backlinkId: row.id,
          messageId: full.messageId,
          inReplyTo: full.inReplyTo,
          fromStatus: row.status,
          toStatus,
          classification: {
            label: classification.label,
            confidence: classification.confidence,
            source: classification.source,
            reason: classification.reason,
          },
        });

        ctx.log.info(
          {
            backlinkId: row.id,
            from: row.status,
            to: toStatus,
            source: classification.source,
            reason: classification.reason,
          },
          'molly-inbox: transitioned backlink',
        );

        // R4.5: hand off to MollyCopywriter when an editor said yes.
        // The agent's per-backlink dedupe key collapses duplicate emits.
        // MollyInbox always runs standalone (cron-driven), so the
        // sub-agent suppression in emitNextStepEvent won't trigger.
        if (toStatus === 'accepted') {
          await ctx.emitNextStepEvent({
            type: 'guest_post.accepted',
            targetAgent: 'molly-copywriter',
            payload: { backlinkId: row.id, site_id: row.siteId },
          });
        }
      } catch (err) {
        ctx.log.warn(
          { messageId: m.messageId, err: err instanceof Error ? err.message : String(err) },
          'molly-inbox: per-message failure, continuing',
        );
      }
    }

    return {
      scanned,
      matched,
      transitions,
      lastSeenAt,
      sinceUsed: since,
    };
  }
}

/**
 * Read the most recent successful MollyInbox run's `output.lastSeenAt` to
 * derive the next poll's `since` bound. Returns null when no prior run
 * exists or its output is malformed — caller defaults to a 7d lookback.
 */
async function loadPriorLastSeenAt(): Promise<string | null> {
  const db = getDb();
  const prior = await db
    .select({ output: agentRuns.output })
    .from(agentRuns)
    .where(and(eq(agentRuns.agent, 'molly-inbox'), eq(agentRuns.status, 'succeeded')))
    .orderBy(desc(agentRuns.startedAt))
    .limit(1);
  const out = prior[0]?.output as { lastSeenAt?: unknown } | undefined;
  if (out && typeof out.lastSeenAt === 'string' && out.lastSeenAt.length > 0) {
    return out.lastSeenAt;
  }
  return null;
}

function defaultSinceIso(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}
