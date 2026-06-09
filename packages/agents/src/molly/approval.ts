import { eq } from 'drizzle-orm';
import {
  getDb,
  agentApprovals,
  backlinks,
  type AgentApproval,
} from '@leadlandlord/db';
import { recordSend } from '@leadlandlord/db/email-throttle';
import { sendEmail as sendEmailZoho, sendReply as sendReplyZoho } from '@leadlandlord/integrations/zoho-mcp';
import { sendEmail as sendEmailResend } from '@leadlandlord/integrations/resend';
import { checkAutoApprove } from '../approval-engine';

/**
 * Approve-before-send gate for Molly's outbound external email (ADR-0006 R4.x).
 *
 * Every message Molly sends to an external recipient — the initial guest-post
 * pitch, each follow-up nudge, and any draft/guest-post email to a blog editor
 * — must queue to the existing `agentApprovals` system and BLOCK until a human
 * approves. The daily `molly-digest` (internal reviewer) is NOT gated and does
 * not call into this module.
 *
 * Design (intentionally migration-free):
 *   - Reuses the `agentApprovals` table with a single new `kind` string,
 *     `MOLLY_OUTREACH_KIND` ('molly_outreach'). `kind` is plain text in the
 *     schema, so no enum/migration change is required.
 *   - Phase 1 is FULLY MANUAL: there is no `autoApproveRule` for Molly, so
 *     `checkAutoApprove` always returns `matched=false` and every row is
 *     `pending`. The call is kept so the moment an operator adds a rule the
 *     auto-approve path lights up with zero code change.
 *   - The full email is captured in `payload` so it can be sent verbatim after
 *     approval, preserving the `messageId` correlation MollyInbox relies on.
 */

/** The single agentApprovals.kind used for all Molly external sends. */
export const MOLLY_OUTREACH_KIND = 'molly_outreach';

/** The bcc_graduation agent name Molly sends are accounted under. */
export const MOLLY_AGENT_NAME = 'molly';

/** Approval rows expire after 14 days un-actioned (matches niche-hunter). */
const MOLLY_APPROVAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type MollyPitchType = 'pitch' | 'nudge' | 'draft';

/**
 * Everything needed to (a) show the operator a faithful preview and (b) send
 * the email verbatim after approval. Stored as `agentApprovals.payload`.
 *
 * NOTE: `bcc` is intentionally NOT persisted here. The BCC graduation decision
 * is re-evaluated at execute time (post-approval) via `decideBcc`, so a row
 * that sits in the queue for days still reflects current graduation state.
 */
export interface MollyOutreachPayload {
  /** Discriminator: 'pitch' (new email), 'nudge' (threaded reply), 'draft'. */
  pitchType: MollyPitchType;
  /** Site the outreach is on behalf of. Null only for site-less drafts. */
  siteId: string | null;
  /** The backlinks row this send belongs to, when one exists. */
  backlinkId: string | null;
  /** External recipient (blog editor). */
  toAddress: string;
  /** From header, e.g. 'molly@leadslandlord.com' (or ZOHO_MOLLY_FROM). */
  fromAddress: string;
  /** Subject line. For nudges this is the "Re: ..." threaded subject. */
  subject: string;
  /** Plain-text body, already persona-signed + compliance-checked. */
  body: string;
  /** email_sends.purpose tag. Defaults to 'guest_post' at execute time. */
  purpose?: string;
  /**
   * For nudges: the Zoho/SMTP messageId of the parent pitch to thread the
   * reply against (`backlinks.messageId`). Required when pitchType==='nudge'.
   */
  inReplyToMessageId?: string | null;
  /** For nudges: which step (1–7) this is, for audit metadata. */
  nudgeStep?: number | null;
  /** Anchor/link metadata carried for the operator + audit trail. */
  anchorType?: string | null;
  /** Target URL the guest post is intended to link to, when known. */
  targetUrl?: string | null;
}

export interface QueueMollyOutreachResult {
  /** The inserted agentApprovals.id. */
  approvalId: string;
  /** 'pending' (always, in Phase 1) or 'auto_approved' if a rule ever matches. */
  status: 'pending' | 'auto_approved';
  /**
   * Whether the caller may proceed with the send NOW. In Phase 1 this is
   * always `false` (manual approval required). The gate at each Molly send
   * site MUST check this and skip the direct send when it is false.
   */
  send: boolean;
}

/**
 * Queue a Molly external send for human approval and BLOCK the direct send.
 *
 * Call this at every Molly external-send site BEFORE `sendEmailZoho` /
 * `sendReplyZoho` / `sendEmailResend`. When `result.send === false` (always,
 * in Phase 1) the caller must NOT send — return early and let the post-approval
 * executor (`executeMollyOutreach`) perform the actual send once an operator
 * approves the row in the operator UI.
 *
 * @param payload  Full email + context, persisted verbatim for later send.
 * @param agentRunId  The current `ctx.runId` of the calling agent.
 * @param db  Optional drizzle handle (defaults to `getDb()`).
 */
export async function queueMollyOutreach(
  payload: MollyOutreachPayload,
  agentRunId: string,
  db: ReturnType<typeof getDb> = getDb(),
): Promise<QueueMollyOutreachResult> {
  // Phase 1: no Molly autoApproveRule exists, so this returns matched=false
  // and every row is 'pending'. Kept for forward-compat with operator rules.
  const autoResult = await checkAutoApprove(MOLLY_OUTREACH_KIND, payload, db);
  const status: 'pending' | 'auto_approved' = autoResult.matched ? 'auto_approved' : 'pending';
  const ruleMatched = autoResult.matched ? autoResult.ruleId : undefined;

  const inserted = await db
    .insert(agentApprovals)
    .values({
      agentRunId,
      kind: MOLLY_OUTREACH_KIND,
      payload: payload as object,
      status,
      decidedBy: status === 'auto_approved' ? `rule:${ruleMatched ?? 'unknown'}` : null,
      decidedAt: status === 'auto_approved' ? new Date() : null,
      ruleMatched: ruleMatched ?? null,
      expiresAt: new Date(Date.now() + MOLLY_APPROVAL_TTL_MS),
    })
    .returning({ id: agentApprovals.id });

  const approvalId = inserted[0]!.id;
  // Phase 1 is fully manual — auto_approved never happens, but if a rule is
  // added later, an auto_approved row may execute inline.
  return { approvalId, status, send: status === 'auto_approved' };
}

export interface ExecuteMollyOutreachResult {
  approvalId: string;
  sent: boolean;
  /** Send-provider messageId, when the send succeeded. */
  externalId: string | null;
  /** Populated when the send was skipped or failed. */
  skippedReason?: string;
}

/**
 * Perform the actual external send for a Molly approval row that an operator
 * has approved. This is the post-approval executor: the operator UI only flips
 * `agentApprovals.status` to 'approved'; nothing else in the codebase reads
 * approved rows and dispatches the side effect (confirmed — there is no generic
 * approval worker). This function is that dispatcher for `molly_outreach`.
 *
 * WHERE TO INVOKE: this is NOT wired to a scheduler in this change set (data
 * layer only). It must be invoked from a Molly-owned execute-on-approval path
 * — recommended: a `scheduler/molly-approvals.ts` sweep (mirroring the existing
 * molly-* schedulers) that selects `agentApprovals` rows
 * `WHERE kind='molly_outreach' AND status='approved'` (and no terminal
 * `decidedAt`-marker / executed flag yet) and calls this for each. The executor
 * is idempotency-guarded: it re-reads the row and refuses to send unless status
 * is still 'approved'.
 *
 * Side effects, in order:
 *   1. Re-fetch the approval row; bail unless status==='approved'/'auto_approved'.
 *   2. Send via Zoho (sendReply for nudges, sendEmail otherwise) or Resend
 *      fallback, exactly mirroring the molly-digest provider-selection idiom.
 *   3. Record to `email_sends` via `recordSend` (preserves throttle accounting).
 *   4. For pitches, persist the returned messageId onto `backlinks.messageId`
 *      so MollyInbox can correlate inbound In-Reply-To headers.
 *   5. Mark the approval row executed (status='executed', decidedAt set) so a
 *      re-run does not double-send.
 *
 * BCC graduation: callers that want BCC must pass `opts.bcc`. This module does
 * not read `decideBcc` itself to keep the data layer free of policy; the
 * recommended sweep computes it (see molly/bcc.ts `decideBcc`) and threads it
 * through. After a successful send the sweep should call `recordBccSend`.
 */
export async function executeMollyOutreach(
  approvalId: string,
  opts: { bcc?: string | null; db?: ReturnType<typeof getDb> } = {},
): Promise<ExecuteMollyOutreachResult> {
  const db = opts.db ?? getDb();

  const row = (
    await db.select().from(agentApprovals).where(eq(agentApprovals.id, approvalId)).limit(1)
  )[0] as AgentApproval | undefined;

  if (!row) {
    return { approvalId, sent: false, externalId: null, skippedReason: 'not_found' };
  }
  if (row.kind !== MOLLY_OUTREACH_KIND) {
    return { approvalId, sent: false, externalId: null, skippedReason: 'wrong_kind' };
  }
  if (row.status !== 'approved' && row.status !== 'auto_approved') {
    // Idempotency guard: only approved rows execute. 'executed', 'pending',
    // 'rejected', 'expired' all no-op here.
    return { approvalId, sent: false, externalId: null, skippedReason: `status:${row.status}` };
  }

  const payload = row.payload as MollyOutreachPayload;
  const purpose = payload.purpose ?? 'guest_post';
  const bcc = opts.bcc ?? undefined;

  // Provider selection mirrors molly-digest exactly.
  const useZoho =
    process.env.ZOHO_MOLLY_ENABLED === 'true' || process.env.ZOHO_MCP_ENABLED === 'true';
  const provider: 'zoho' | 'resend' = useZoho ? 'zoho' : 'resend';
  const from = payload.fromAddress;
  const mailbox = useZoho
    ? (process.env.ZOHO_MOLLY_FROM ?? payload.fromAddress)
    : (process.env.RESEND_FROM_ADDRESS ?? payload.fromAddress);

  let externalId: string | null = null;
  let sendError: string | null = null;

  try {
    if (payload.pitchType === 'nudge') {
      if (!payload.inReplyToMessageId) {
        return {
          approvalId,
          sent: false,
          externalId: null,
          skippedReason: 'nudge_missing_parent_message_id',
        };
      }
      // Nudges always thread via Zoho reply. There is no Resend reply path.
      const res = await sendReplyZoho({
        inReplyToMessageId: payload.inReplyToMessageId,
        to: payload.toAddress,
        from,
        subject: payload.subject,
        text: payload.body,
        ...(bcc ? { bcc } : {}),
      });
      externalId = res.messageId;
    } else if (useZoho) {
      const res = await sendEmailZoho({
        to: payload.toAddress,
        from,
        subject: payload.subject,
        text: payload.body,
        ...(bcc ? { bcc } : {}),
      });
      externalId = res.messageId;
    } else {
      const res = await sendEmailResend({
        to: payload.toAddress,
        from,
        subject: payload.subject,
        text: payload.body,
        ...(bcc ? { bcc: [bcc] } : {}),
      });
      externalId = res.messageId;
    }
  } catch (err) {
    sendError = err instanceof Error ? err.message : String(err);
  }

  // Audit + throttle accounting (mirrors backlink/outreach recordSend calls).
  await recordSend({
    siteId: payload.siteId,
    mailbox,
    toAddress: payload.toAddress,
    subject: payload.subject,
    purpose,
    provider: provider === 'zoho' ? 'zoho' : 'resend',
    externalId,
    status: sendError ? 'failed' : 'sent',
    errorMessage: sendError,
    metadata: {
      approvalId,
      pitchType: payload.pitchType,
      ...(payload.backlinkId ? { backlinkId: payload.backlinkId } : {}),
      ...(payload.nudgeStep ? { nudgeStep: payload.nudgeStep } : {}),
      ...(bcc ? { bcc } : {}),
    },
  });

  if (sendError) {
    // Leave the approval 'approved' so a retry sweep can re-attempt the send.
    return { approvalId, sent: false, externalId: null, skippedReason: `send_failed:${sendError}` };
  }

  // Preserve the messageId correlation MollyInbox depends on. Only the initial
  // pitch establishes the thread root, so only pitches write backlinks.messageId.
  if (payload.pitchType === 'pitch' && payload.backlinkId && externalId) {
    await db
      .update(backlinks)
      .set({ messageId: externalId })
      .where(eq(backlinks.id, payload.backlinkId));
  }

  // Mark executed so a re-run of the sweep cannot double-send this row.
  await db
    .update(agentApprovals)
    .set({ status: 'executed', updatedAt: new Date() })
    .where(eq(agentApprovals.id, approvalId));

  return { approvalId, sent: true, externalId };
}
