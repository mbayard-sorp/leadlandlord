/**
 * Molly pitch mode (prospect_approved) — sends an initial guest-post pitch
 * to an approved prospect via Zoho.
 *
 * Guards (in order):
 *   1. Prospect exists and status === 'approved'.
 *   2. backlinkId is null (already pitched — no-op success).
 *   3. Footprint re-check (same domain pitched/approved on another site).
 *   4. Suppression list check (contactEmail not on email suppression list).
 *   5. ZOHO_MOLLY_ENABLED !== 'true' — graceful no-op.
 *
 * Contact discovery (if contactEmail empty):
 *   - Firecrawl scrapeContact first, Apollo findEditorByDomain fallback.
 *   - No contact found: set contactState='missing', return graceful success.
 *     Do NOT throw — must not dead-letter. Prospect stays approved.
 *
 * Happy path:
 *   - Scrape prospect homepage for personalization (reuse metadata.receptivity.sampledUrls).
 *   - Generate pitch via Sonnet with MOLLY_PERSONA voice + few-shots.
 *   - decideBcc / recordBccSend.
 *   - sendEmail via Zoho.
 *   - Insert backlinks row (guest_post, submitted, onConflictDoNothing).
 *   - Update prospect: status=pitched, backlinkId, pitchedAt in metadata.
 */

import { z } from 'zod';
import { eq, and, inArray } from 'drizzle-orm';
import {
  getDb,
  backlinkProspects,
  backlinks,
} from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { scrapeContact, scrapeUrlMarkdown } from '@leadlandlord/integrations/firecrawl';
import { findEditorByDomain } from '@leadlandlord/integrations/apollo';
import { sendEmail } from '@leadlandlord/integrations/zoho-mcp';
import { isSuppressed } from '@leadlandlord/db';
import type { AgentContext } from '../base';
import { MOLLY_PERSONA } from './persona';
import { decideBcc, recordBccSend } from './bcc';
import { log as rootLog } from '@leadlandlord/shared/log';

// ── Constants ─────────────────────────────────────────────────────────────────

const PITCH_MODEL = 'claude-sonnet-4-6';

// ── Output schema ─────────────────────────────────────────────────────────────

export const PitchOutput = z.object({
  prospectId: z.string().uuid(),
  status: z.enum([
    'pitched',
    'skipped_not_approved',
    'skipped_already_pitched',
    'skipped_footprint',
    'skipped_suppressed',
    'skipped_no_contact',
    'skipped_zoho_disabled',
  ]),
  backlinkId: z.string().uuid().nullable(),
  contactEmail: z.string().nullable(),
});
export type PitchOutput = z.infer<typeof PitchOutput>;

// ── Main function ─────────────────────────────────────────────────────────────

export async function runPitch(
  input: { siteId: string; prospectId: string },
  ctx: AgentContext,
): Promise<PitchOutput> {
  const db = getDb();
  const log = rootLog.child({ agent: 'molly', mode: 'pitch', prospectId: input.prospectId, runId: ctx.runId });

  // ── Guard 1: prospect exists and is approved ────────────────────────────────
  const prospect = (
    await db.select().from(backlinkProspects).where(eq(backlinkProspects.id, input.prospectId)).limit(1)
  )[0];
  if (!prospect) {
    log.warn('prospect not found');
    return { prospectId: input.prospectId, status: 'skipped_not_approved', backlinkId: null, contactEmail: null };
  }
  if (prospect.status !== 'approved') {
    log.info({ status: prospect.status }, 'prospect not in approved state — no-op');
    return { prospectId: input.prospectId, status: 'skipped_not_approved', backlinkId: null, contactEmail: null };
  }

  // ── Guard 2: already pitched ────────────────────────────────────────────────
  if (prospect.backlinkId) {
    log.info({ backlinkId: prospect.backlinkId }, 'prospect already has backlinkId — no-op');
    return { prospectId: input.prospectId, status: 'skipped_already_pitched', backlinkId: prospect.backlinkId, contactEmail: prospect.contactEmail };
  }

  // ── Guard 3: footprint re-check ─────────────────────────────────────────────
  // Same check as approveProspect in prospect-actions.ts: another site
  // already has this domain in approved or pitched state.
  const conflicts = await db
    .select({ id: backlinkProspects.id, siteId: backlinkProspects.siteId })
    .from(backlinkProspects)
    .where(
      and(
        eq(backlinkProspects.domain, prospect.domain),
        inArray(backlinkProspects.status, ['approved', 'pitched']),
      ),
    );
  const otherSiteConflict = conflicts.find((c) => c.siteId !== prospect.siteId && c.id !== prospect.id);
  if (otherSiteConflict) {
    log.warn({ domain: prospect.domain }, 'footprint guard triggered — skip pitch');
    return { prospectId: input.prospectId, status: 'skipped_footprint', backlinkId: null, contactEmail: null };
  }

  // ── Contact discovery (if contactEmail empty) ───────────────────────────────
  let contactEmail = prospect.contactEmail?.trim() || null;
  let contactName = prospect.contactName?.trim() || null;

  if (!contactEmail) {
    ctx.progress({ label: `contact discovery: ${prospect.domain}` });

    // Path A: Firecrawl scrapeContact.
    try {
      const scraped = await scrapeContact(prospect.domain);
      if (scraped) {
        contactEmail = scraped.email;
        contactName = scraped.name ?? null;
        log.info({ domain: prospect.domain, source: 'firecrawl' }, 'contact found via Firecrawl');
      }
    } catch (err) {
      log.warn({ domain: prospect.domain, err: err instanceof Error ? err.message : err }, 'Firecrawl contact scrape failed');
    }

    // Path B: Apollo findEditorByDomain fallback.
    if (!contactEmail) {
      try {
        const apolloResult = await findEditorByDomain(prospect.domain);
        if (apolloResult?.person) {
          const person = apolloResult.person;
          const apolloEmail = person.email ?? null;
          if (apolloEmail && !apolloEmail.toLowerCase().includes('email_not_unlocked')) {
            contactEmail = apolloEmail;
            contactName = person.name ?? null;
            log.info({ domain: prospect.domain, source: 'apollo' }, 'contact found via Apollo');
          }
        }
      } catch (err) {
        log.warn({ domain: prospect.domain, err: err instanceof Error ? err.message : err }, 'Apollo lookup failed');
      }
    }

    if (!contactEmail) {
      // No contact found: set contactState='missing', return graceful success.
      // Do NOT throw. The operator will enter contact via setProspectContact which
      // re-emits prospect.approved with a new dedupeKey.
      log.info({ domain: prospect.domain }, 'no contact found — setting contactState=missing');
      await db
        .update(backlinkProspects)
        .set({ contactState: 'missing', updatedAt: new Date() })
        .where(eq(backlinkProspects.id, input.prospectId));
      return { prospectId: input.prospectId, status: 'skipped_no_contact', backlinkId: null, contactEmail: null };
    }

    // Persist discovered contact.
    await db
      .update(backlinkProspects)
      .set({
        contactEmail,
        contactName: contactName ?? undefined,
        contactState: 'found',
        updatedAt: new Date(),
      })
      .where(eq(backlinkProspects.id, input.prospectId));
  }

  // ── Guard 4: suppression list ───────────────────────────────────────────────
  if (await isSuppressed(contactEmail, 'email')) {
    log.info({ contactEmail }, 'contact email is suppressed — skip');
    return { prospectId: input.prospectId, status: 'skipped_suppressed', backlinkId: null, contactEmail };
  }

  // ── Guard 5: ZOHO gate ──────────────────────────────────────────────────────
  if (process.env.ZOHO_MOLLY_ENABLED !== 'true') {
    log.info('ZOHO_MOLLY_ENABLED is not true — graceful no-op');
    return { prospectId: input.prospectId, status: 'skipped_zoho_disabled', backlinkId: null, contactEmail };
  }

  // ── Homepage scrape for personalization ─────────────────────────────────────
  ctx.progress({ label: `scraping ${prospect.domain} for personalization` });

  let homepageMarkdown: string | null = null;
  const existingMeta = (prospect.metadata ?? {}) as Record<string, unknown>;
  const receptivity = existingMeta['receptivity'] as { sampledUrls?: string[] } | undefined;
  const sampledUrl = receptivity?.sampledUrls?.[0];

  if (sampledUrl) {
    homepageMarkdown = await scrapeUrlMarkdown(sampledUrl);
  }
  if (!homepageMarkdown) {
    homepageMarkdown = await scrapeUrlMarkdown(`https://${prospect.domain}`);
  }

  // ── Pitch generation ─────────────────────────────────────────────────────────
  ctx.progress({ label: 'generating pitch with Claude' });

  const postalAddress = process.env.LEADLANDLORD_POSTAL_ADDRESS ?? '[POSTAL ADDRESS]';
  const fromAddress = process.env.ZOHO_MOLLY_FROM ?? MOLLY_PERSONA.mailbox;

  const siteInfo = `Site niche: ${(prospect as unknown as Record<string, unknown>)['siteNiche'] ?? 'local home services'}`;

  const pitchUserPrompt = [
    `Write an initial guest-post pitch email to the editor of ${prospect.domain}.`,
    contactName ? `The editor's name is ${contactName}.` : `The editor's name is unknown.`,
    ...(homepageMarkdown
      ? [
          `Here is content from the target blog for personalization (reference something specific):`,
          homepageMarkdown.slice(0, 3000),
        ]
      : ['No homepage content available. Acknowledge you read the blog without citing a specific post.']),
    ``,
    `The postal address for CAN-SPAM compliance is: ${postalAddress}`,
    ``,
    `Return JSON only: {"subject": "...", "body": "..."}`,
    `The body must include the unsubscribe line: "Reply REMOVE if you'd rather not hear from me."`,
    `The body must include the postal address on its own line at the end.`,
  ].join('\n');

  const client = getAnthropicClient();

  // Build few-shot messages from MOLLY_PERSONA.
  const fewShotMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const shot of MOLLY_PERSONA.fewShot) {
    fewShotMessages.push({ role: 'user', content: shot.userMsg });
    fewShotMessages.push({ role: 'assistant', content: shot.assistantMsg });
  }

  const pitchResponse = await client.messages.create({
    model: PITCH_MODEL,
    max_tokens: 1500,
    system: MOLLY_PERSONA.voiceSystemPrompt,
    messages: [
      ...fewShotMessages,
      { role: 'user', content: pitchUserPrompt },
    ],
  });

  const pitchUsage = pitchResponse.usage;
  ctx.recordUsage({
    model: PITCH_MODEL,
    input_tokens: pitchUsage.input_tokens,
    output_tokens: pitchUsage.output_tokens,
    cache_read_input_tokens: pitchUsage.cache_read_input_tokens ?? undefined,
    cache_creation_input_tokens: pitchUsage.cache_creation_input_tokens ?? undefined,
    cost_usd: estimateCostUsd(PITCH_MODEL, {
      input_tokens: pitchUsage.input_tokens,
      output_tokens: pitchUsage.output_tokens,
      cache_read_input_tokens: pitchUsage.cache_read_input_tokens ?? undefined,
      cache_creation_input_tokens: pitchUsage.cache_creation_input_tokens ?? undefined,
    }),
  });

  const textBlock = pitchResponse.content.find((b) => b.type === 'text');
  const rawText = textBlock?.type === 'text' ? textBlock.text : '';

  // Extract JSON — Claude may wrap in markdown fences.
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('molly pitch: Claude did not return JSON');

  let pitchDraft: { subject: string; body: string };
  try {
    pitchDraft = JSON.parse(jsonMatch[0]) as { subject: string; body: string };
  } catch {
    throw new Error(`molly pitch: failed to parse Claude JSON response: ${rawText.slice(0, 200)}`);
  }

  if (!pitchDraft.subject || !pitchDraft.body) {
    throw new Error('molly pitch: Claude returned empty subject or body');
  }

  // ── BCC decision ─────────────────────────────────────────────────────────────
  const bccDecision = await decideBcc('molly');

  // ── Send email ───────────────────────────────────────────────────────────────
  ctx.progress({ label: `sending pitch to ${contactEmail}` });

  const sendResult = await sendEmail({
    from: fromAddress,
    to: contactEmail,
    subject: pitchDraft.subject,
    text: pitchDraft.body,
    ...(bccDecision.bcc ? { bcc: bccDecision.bcc } : {}),
  });

  await recordBccSend('molly');
  log.info({ messageId: sendResult.messageId, contactEmail }, 'pitch sent');

  // ── Insert backlinks row ─────────────────────────────────────────────────────
  const dedupeKey = `guest_post:${prospect.siteId}:${prospect.domain}`;
  const now = new Date();

  const [backlinkRow] = await db
    .insert(backlinks)
    .values({
      siteId: prospect.siteId,
      sourceDomain: prospect.domain,
      type: 'guest_post',
      status: 'submitted',
      messageId: sendResult.messageId,
      dedupeKey,
      createdAt: now,
      metadata: {
        pitchedAt: now.toISOString(),
        contactEmail,
        contactName: contactName ?? undefined,
      },
    })
    .onConflictDoNothing({ target: [backlinks.dedupeKey] })
    .returning({ id: backlinks.id });

  const backlinkId = backlinkRow?.id ?? null;

  // ── Update prospect ──────────────────────────────────────────────────────────
  await db
    .update(backlinkProspects)
    .set({
      status: 'pitched',
      backlinkId: backlinkId ?? undefined,
      contactEmail,
      contactName: contactName ?? undefined,
      contactState: 'found',
      metadata: {
        ...existingMeta,
        pitchedAt: now.toISOString(),
        messageId: sendResult.messageId,
      },
      updatedAt: now,
    })
    .where(eq(backlinkProspects.id, input.prospectId));

  log.info({ backlinkId, contactEmail }, 'pitch mode complete');

  return {
    prospectId: input.prospectId,
    status: 'pitched',
    backlinkId,
    contactEmail,
  };
}
