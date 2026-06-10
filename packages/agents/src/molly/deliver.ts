/**
 * Molly deliver mode — sends an approved guest-post draft to the editor as a
 * threaded reply with a short Molly cover note.
 *
 * Guards:
 *   1. Backlink exists.
 *   2. Backlink status === 'draft_approved' AND draftMarkdown is present.
 *   3. ZOHO_MOLLY_ENABLED !== 'true' — graceful no-op.
 *
 * After send:
 *   - Status -> 'delivered'.
 *   - draftMarkdown moved into metadata.deliveredDraft (column cleared per spec
 *     unless other consumers read it — checked: only MollyCopywriter writes it,
 *     nothing else reads it after draft_approved, so we clear it).
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

const DELIVER_MODEL = 'claude-haiku-4-5';

// ── Output schema ─────────────────────────────────────────────────────────────

export const DeliverOutput = z.object({
  backlinkId: z.string().uuid(),
  status: z.enum([
    'delivered',
    'skipped_not_found',
    'skipped_wrong_status',
    'skipped_no_draft',
    'skipped_zoho_disabled',
  ]),
});
export type DeliverOutput = z.infer<typeof DeliverOutput>;

// ── Main function ─────────────────────────────────────────────────────────────

export async function runDeliver(
  input: { backlinkId: string; siteId?: string },
  ctx: AgentContext,
): Promise<DeliverOutput> {
  const db = getDb();
  const log = rootLog.child({ agent: 'molly', mode: 'deliver', backlinkId: input.backlinkId, runId: ctx.runId });

  // ── Guard 1: backlink exists ────────────────────────────────────────────────
  const backlink = (
    await db.select().from(backlinks).where(eq(backlinks.id, input.backlinkId)).limit(1)
  )[0];
  if (!backlink) {
    log.warn('backlink not found');
    return { backlinkId: input.backlinkId, status: 'skipped_not_found' };
  }

  // ── Guard 2: status and draft present ──────────────────────────────────────
  if (backlink.status !== 'draft_approved') {
    log.info({ status: backlink.status }, 'backlink not in draft_approved — no-op');
    return { backlinkId: input.backlinkId, status: 'skipped_wrong_status' };
  }
  if (!backlink.draftMarkdown) {
    log.warn('backlink has no draftMarkdown — cannot deliver');
    return { backlinkId: input.backlinkId, status: 'skipped_no_draft' };
  }

  // ── Guard 3: ZOHO gate ──────────────────────────────────────────────────────
  if (process.env.ZOHO_MOLLY_ENABLED !== 'true') {
    log.info('ZOHO_MOLLY_ENABLED is not true — graceful no-op');
    return { backlinkId: input.backlinkId, status: 'skipped_zoho_disabled' };
  }

  if (!backlink.messageId) {
    log.warn('backlink has no messageId — cannot send threaded delivery');
    return { backlinkId: input.backlinkId, status: 'skipped_not_found' };
  }

  // ── Look up contact email ────────────────────────────────────────────────────
  const prospect = (
    await db
      .select()
      .from(backlinkProspects)
      .where(eq(backlinkProspects.backlinkId, input.backlinkId))
      .limit(1)
  )[0];

  const toAddress = prospect?.contactEmail ?? null;
  if (!toAddress) {
    log.warn({ backlinkId: input.backlinkId }, 'no contact email found for delivery — skip');
    return { backlinkId: input.backlinkId, status: 'skipped_not_found' };
  }

  // ── Generate cover note ──────────────────────────────────────────────────────
  ctx.progress({ label: `generating delivery cover note for ${backlink.sourceDomain}` });

  const coverNotePrompt = [
    `Write a short email cover note to accompany the delivery of a guest-post draft to ${backlink.sourceDomain}.`,
    `Molly is delivering the draft the editor agreed to in a previous exchange.`,
    `Keep it to 40-60 words. Warm but brief. Mention the draft is attached below in the email.`,
    `Return JSON only: {"subject": "...", "body": "..."}`,
    `The subject should reference the original pitch thread.`,
    `Include Molly's signature line.`,
    `No postal address, no unsubscribe line (this is a requested delivery, not cold outreach).`,
  ].join('\n');

  const client = getAnthropicClient();

  const fewShotMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const shot of MOLLY_PERSONA.fewShot) {
    fewShotMessages.push({ role: 'user', content: shot.userMsg });
    fewShotMessages.push({ role: 'assistant', content: shot.assistantMsg });
  }

  const coverResponse = await client.messages.create({
    model: DELIVER_MODEL,
    max_tokens: 500,
    system: MOLLY_PERSONA.voiceSystemPrompt,
    messages: [
      ...fewShotMessages,
      { role: 'user', content: coverNotePrompt },
    ],
  });

  const coverUsage = coverResponse.usage;
  ctx.recordUsage({
    model: DELIVER_MODEL,
    input_tokens: coverUsage.input_tokens,
    output_tokens: coverUsage.output_tokens,
    cost_usd: estimateCostUsd(DELIVER_MODEL, {
      input_tokens: coverUsage.input_tokens,
      output_tokens: coverUsage.output_tokens,
    }),
  });

  const textBlock = coverResponse.content.find((b) => b.type === 'text');
  const rawText = textBlock?.type === 'text' ? textBlock.text : '';

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('molly deliver: Claude did not return JSON for cover note');

  let coverDraft: { subject: string; body: string };
  try {
    coverDraft = JSON.parse(jsonMatch[0]) as { subject: string; body: string };
  } catch {
    throw new Error(`molly deliver: failed to parse Claude JSON: ${rawText.slice(0, 200)}`);
  }

  if (!coverDraft.subject || !coverDraft.body) {
    throw new Error('molly deliver: Claude returned empty subject or body');
  }

  // Append the draft below the cover note, clearly separated.
  const fullBody = [
    coverDraft.body,
    '',
    '---',
    '',
    backlink.draftMarkdown,
  ].join('\n');

  // ── BCC decision ─────────────────────────────────────────────────────────────
  const bccDecision = await decideBcc('molly');

  const fromAddress = process.env.ZOHO_MOLLY_FROM ?? MOLLY_PERSONA.mailbox;

  // ── Send as threaded reply ───────────────────────────────────────────────────
  ctx.progress({ label: `delivering draft to ${toAddress}` });

  const sendResult = await sendReply({
    from: fromAddress,
    to: toAddress,
    subject: coverDraft.subject,
    text: fullBody,
    inReplyToMessageId: backlink.messageId,
    ...(bccDecision.bcc ? { bcc: bccDecision.bcc } : {}),
  });

  await recordBccSend('molly');
  log.info({ messageId: sendResult.messageId, toAddress }, 'draft delivered');

  // ── Update backlink ──────────────────────────────────────────────────────────
  const now = new Date();
  const existingMeta = (backlink.metadata ?? {}) as Record<string, unknown>;

  await db
    .update(backlinks)
    .set({
      status: 'delivered',
      // Move draftMarkdown into metadata.deliveredDraft and clear the column.
      draftMarkdown: null,
      metadata: {
        ...existingMeta,
        deliveredDraft: backlink.draftMarkdown,
        deliveredAt: now.toISOString(),
        deliveryMessageId: sendResult.messageId,
      },
    })
    .where(eq(backlinks.id, input.backlinkId));

  log.info('deliver mode complete');

  return {
    backlinkId: input.backlinkId,
    status: 'delivered',
  };
}
