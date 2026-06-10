/**
 * Molly nudge mode — sends a follow-up nudge to a prospect that has not replied.
 *
 * Guards (in order):
 *   1. Backlink exists.
 *   2. expectedNudgeCount === backlink.nudgeCount (stale event — no-op).
 *   3. Backlink status is 'submitted' or 'awaiting_reply'.
 *   4. nudgeCount < 7 (max 7 nudges over 21 days).
 *   5. ZOHO_MOLLY_ENABLED !== 'true' — graceful no-op.
 *
 * Send: threaded reply via sendReply (ZohoMail_sendReplyEmail) using stored messageId.
 * After send: increment nudgeCount, update lastNudgeAt, status -> awaiting_reply.
 */

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, backlinks, backlinkProspects } from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { sendReply } from '@leadlandlord/integrations/zoho-mcp';
import type { AgentContext } from '../base';
import { MOLLY_PERSONA } from './persona';
import { decideBcc, recordBccSend } from './bcc';
import { log as rootLog } from '@leadlandlord/shared/log';

// ── Constants ─────────────────────────────────────────────────────────────────

const NUDGE_MODEL = 'claude-haiku-4-5';
const MAX_NUDGE_COUNT = 7;

// ── Output schema ─────────────────────────────────────────────────────────────

export const NudgeOutput = z.object({
  backlinkId: z.string().uuid(),
  status: z.enum([
    'nudged',
    'skipped_not_found',
    'skipped_stale_count',
    'skipped_wrong_status',
    'skipped_max_nudges',
    'skipped_zoho_disabled',
  ]),
  nudgeCount: z.number().int(),
});
export type NudgeOutput = z.infer<typeof NudgeOutput>;

// ── Main function ─────────────────────────────────────────────────────────────

export async function runNudge(
  input: { backlinkId: string; expectedNudgeCount: number; siteId?: string },
  ctx: AgentContext,
): Promise<NudgeOutput> {
  const db = getDb();
  const log = rootLog.child({ agent: 'molly', mode: 'nudge', backlinkId: input.backlinkId, runId: ctx.runId });

  // ── Guard 1: backlink exists ────────────────────────────────────────────────
  const backlink = (
    await db.select().from(backlinks).where(eq(backlinks.id, input.backlinkId)).limit(1)
  )[0];
  if (!backlink) {
    log.warn('backlink not found');
    return { backlinkId: input.backlinkId, status: 'skipped_not_found', nudgeCount: 0 };
  }

  // ── Guard 2: stale nudge count ──────────────────────────────────────────────
  // If the scheduler emitted this event and then nudgeCount advanced (another
  // nudge fired first), the event is stale. Skip without error.
  if (input.expectedNudgeCount !== backlink.nudgeCount) {
    log.info(
      { expected: input.expectedNudgeCount, actual: backlink.nudgeCount },
      'stale nudge event — no-op',
    );
    return { backlinkId: input.backlinkId, status: 'skipped_stale_count', nudgeCount: backlink.nudgeCount };
  }

  // ── Guard 3: status check ───────────────────────────────────────────────────
  if (backlink.status !== 'submitted' && backlink.status !== 'awaiting_reply') {
    log.info({ status: backlink.status }, 'backlink not in submitted/awaiting_reply — no-op');
    return { backlinkId: input.backlinkId, status: 'skipped_wrong_status', nudgeCount: backlink.nudgeCount };
  }

  // ── Guard 4: cap check ──────────────────────────────────────────────────────
  if (backlink.nudgeCount >= MAX_NUDGE_COUNT) {
    log.info({ nudgeCount: backlink.nudgeCount }, 'max nudges reached — no-op');
    return { backlinkId: input.backlinkId, status: 'skipped_max_nudges', nudgeCount: backlink.nudgeCount };
  }

  // ── Guard 5: ZOHO gate ──────────────────────────────────────────────────────
  if (process.env.ZOHO_MOLLY_ENABLED !== 'true') {
    log.info('ZOHO_MOLLY_ENABLED is not true — graceful no-op');
    return { backlinkId: input.backlinkId, status: 'skipped_zoho_disabled', nudgeCount: backlink.nudgeCount };
  }

  if (!backlink.messageId) {
    // No messageId means we can't thread a reply. Log and skip.
    log.warn('backlink has no messageId — cannot send threaded nudge');
    return { backlinkId: input.backlinkId, status: 'skipped_not_found', nudgeCount: backlink.nudgeCount };
  }

  // ── Look up contact email from prospect ─────────────────────────────────────
  // Find the linked prospect to get the contact address.
  const prospect = backlink.siteId
    ? (
        await db
          .select()
          .from(backlinkProspects)
          .where(eq(backlinkProspects.backlinkId, input.backlinkId))
          .limit(1)
      )[0]
    : undefined;

  const toAddress = prospect?.contactEmail ?? null;
  if (!toAddress) {
    log.warn({ backlinkId: input.backlinkId }, 'no contact email found for nudge — skip');
    return { backlinkId: input.backlinkId, status: 'skipped_not_found', nudgeCount: backlink.nudgeCount };
  }

  // ── Generate nudge ───────────────────────────────────────────────────────────
  ctx.progress({ label: `generating nudge ${backlink.nudgeCount + 1} for ${backlink.sourceDomain}` });

  const nudgeNumber = backlink.nudgeCount + 1;
  const originalSubject = backlink.subjectLine ?? `Guest post idea for ${backlink.sourceDomain}`;

  const nudgeUserPrompt = [
    `Write a day-${nudgeNumber * 3} follow-up nudge email.`,
    `Molly sent an initial guest-post pitch ${nudgeNumber * 3} days ago. No reply yet.`,
    `The original subject was: "${originalSubject}"`,
    `This is nudge number ${nudgeNumber} of a maximum of ${MAX_NUDGE_COUNT}.`,
    `Keep it short (60-80 words). Do not repeat the full pitch.`,
    `Return JSON only: {"subject": "...", "body": "..."}`,
    `The subject should be "Re: ${originalSubject}" or similar.`,
    `The body must include: "Reply REMOVE if you'd rather not hear from me."`,
    `No postal address needed for follow-up nudges.`,
  ].join('\n');

  const client = getAnthropicClient();

  const fewShotMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const shot of MOLLY_PERSONA.fewShot) {
    fewShotMessages.push({ role: 'user', content: shot.userMsg });
    fewShotMessages.push({ role: 'assistant', content: shot.assistantMsg });
  }

  const nudgeResponse = await client.messages.create({
    model: NUDGE_MODEL,
    max_tokens: 600,
    system: MOLLY_PERSONA.voiceSystemPrompt,
    messages: [
      ...fewShotMessages,
      { role: 'user', content: nudgeUserPrompt },
    ],
  });

  const nudgeUsage = nudgeResponse.usage;
  ctx.recordUsage({
    model: NUDGE_MODEL,
    input_tokens: nudgeUsage.input_tokens,
    output_tokens: nudgeUsage.output_tokens,
    cost_usd: estimateCostUsd(NUDGE_MODEL, {
      input_tokens: nudgeUsage.input_tokens,
      output_tokens: nudgeUsage.output_tokens,
    }),
  });

  const textBlock = nudgeResponse.content.find((b) => b.type === 'text');
  const rawText = textBlock?.type === 'text' ? textBlock.text : '';

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('molly nudge: Claude did not return JSON');

  let nudgeDraft: { subject: string; body: string };
  try {
    nudgeDraft = JSON.parse(jsonMatch[0]) as { subject: string; body: string };
  } catch {
    throw new Error(`molly nudge: failed to parse Claude JSON: ${rawText.slice(0, 200)}`);
  }

  if (!nudgeDraft.subject || !nudgeDraft.body) {
    throw new Error('molly nudge: Claude returned empty subject or body');
  }

  // ── BCC decision ─────────────────────────────────────────────────────────────
  const bccDecision = await decideBcc('molly');

  const fromAddress = process.env.ZOHO_MOLLY_FROM ?? MOLLY_PERSONA.mailbox;

  // ── Send as threaded reply ───────────────────────────────────────────────────
  // ZohoMail_sendReplyEmail threads the reply in the original conversation.
  // TODO(Phase 4): verify Zoho reply threading is working live. If the
  // recipient sees a fresh email rather than a thread, the subject "Re: ..."
  // approach is a fallback that preserves the conversational context.
  ctx.progress({ label: `sending nudge ${nudgeNumber} to ${toAddress}` });

  const sendResult = await sendReply({
    from: fromAddress,
    to: toAddress,
    subject: nudgeDraft.subject,
    text: nudgeDraft.body,
    inReplyToMessageId: backlink.messageId,
    ...(bccDecision.bcc ? { bcc: bccDecision.bcc } : {}),
  });

  await recordBccSend('molly');
  log.info({ messageId: sendResult.messageId, nudgeNumber }, 'nudge sent');

  // ── Update backlink ──────────────────────────────────────────────────────────
  const now = new Date();
  const newNudgeCount = backlink.nudgeCount + 1;

  await db
    .update(backlinks)
    .set({
      nudgeCount: newNudgeCount,
      lastNudgeAt: now,
      status: 'awaiting_reply',
    })
    .where(eq(backlinks.id, input.backlinkId));

  log.info({ nudgeCount: newNudgeCount }, 'nudge mode complete');

  return {
    backlinkId: input.backlinkId,
    status: 'nudged',
    nudgeCount: newNudgeCount,
  };
}
