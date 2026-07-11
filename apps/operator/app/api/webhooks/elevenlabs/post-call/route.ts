import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';
import { getDb, calls, sites, type Call } from '@leadlandlord/db';
import { verifyElevenLabsWebhook } from '@leadlandlord/integrations/elevenlabs';
import { LeadQualifier } from '@leadlandlord/agents/lead-qualifier';
import { log } from '@leadlandlord/shared/log';
import { notifyTenantOfQualifiedLead } from '../../../../../lib/tenant-lead-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ElevenLabs "post_call_transcription" webhook. Fires once a Conversational
 * AI call finishes and analysis is ready. Payload shapes vary by ElevenLabs
 * API version, so we parse defensively (zod `.passthrough()` + optional
 * chains) rather than assuming one exact shape.
 *
 * Sync: verify signature, correlate to a `calls` row by Twilio CallSid
 * (fallback: elevenlabsConversationId), persist transcript/summary
 * idempotently. `after()`: run LeadQualifier, then the tenant notification
 * seam (lib/tenant-lead-notify.ts — a Phase D stub for now).
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('elevenlabs-signature');

  if (!isVerified(rawBody, signatureHeader)) {
    log.warn({}, 'elevenlabs post-call webhook signature mismatch');
    return new NextResponse('forbidden', { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'elevenlabs post-call: invalid JSON body');
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const parsed = PostCallPayload.safeParse(json);
  if (!parsed.success) {
    log.warn({ issues: parsed.error.issues }, 'elevenlabs post-call: payload failed schema');
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const data = parsed.data.data ?? {};
  const conversationId = data.conversation_id;
  const callSid = extractCallSid(data);
  const transcriptText = extractTranscriptText(data.transcript);
  const summary = data.analysis?.transcript_summary;

  const db = getDb();
  let call: Call | undefined;
  if (callSid) {
    call = (await db.select().from(calls).where(eq(calls.twilioCallSid, callSid)).limit(1))[0];
  }
  if (!call && conversationId) {
    call = (
      await db.select().from(calls).where(eq(calls.elevenlabsConversationId, conversationId)).limit(1)
    )[0];
  }
  if (!call) {
    // Webhooks must not retry-storm on an unmatched call — 200 + ignored.
    log.warn({ conversationId, callSid }, 'elevenlabs post-call: no matching call row');
    return NextResponse.json({ ok: true, ignored: true });
  }

  const metadata: Record<string, unknown> = { ...(call.metadata as Record<string, unknown> | null) };
  if (summary) metadata.elevenlabsSummary = summary;

  const updates: Partial<typeof calls.$inferInsert> = {
    answeredBy: call.answeredBy ?? 'ai',
    metadata,
  };
  if (conversationId && call.elevenlabsConversationId !== conversationId) {
    updates.elevenlabsConversationId = conversationId;
  }
  // Only fill transcript if we don't already have one (idempotent: repeated
  // webhook deliveries for the same call shouldn't clobber a good transcript
  // with a partial/retry payload).
  if (transcriptText && !call.transcript) {
    updates.transcript = transcriptText;
  }

  const [updated] = await db.update(calls).set(updates).where(eq(calls.id, call.id)).returning();
  const finalCall = updated ?? { ...call, ...updates };

  log.info({ callId: finalCall.id, conversationId, callSid }, 'elevenlabs post-call: transcript synced');

  // Run qualification + tenant notify in the background so ElevenLabs doesn't time out.
  after(() => runQualificationAndNotify(finalCall as Call));

  return NextResponse.json({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────
// Signature verification
// ─────────────────────────────────────────────────────────────────────────

/**
 * Verify the ElevenLabs-Signature header, with the same "don't brick local
 * dev / mock-mode" posture Twilio verification uses: in production a missing
 * secret always rejects; outside production (or with MOCK_TELEPHONY=true) a
 * missing secret allows the webhook through unverified so mock-mode E2E
 * flows stay testable without a live ElevenLabs account.
 */
function isVerified(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  const bypass =
    process.env.MOCK_TELEPHONY === 'true' || (!secret && process.env.NODE_ENV !== 'production');
  if (bypass) return true;
  return verifyElevenLabsWebhook({ rawBody, signatureHeader, secret });
}

// ─────────────────────────────────────────────────────────────────────────
// Defensive payload parsing — ElevenLabs post_call_transcription webhook.
// Known shape (may drift across API versions):
//   { type: 'post_call_transcription', data: { conversation_id, agent_id,
//     metadata: { phone_call: { call_sid, ... } }, transcript: [{role,message}],
//     analysis: { transcript_summary, call_successful }, ... } }
// ─────────────────────────────────────────────────────────────────────────

const TranscriptTurn = z
  .object({
    role: z.string().optional(),
    message: z.string().nullable().optional(),
  })
  .passthrough();

const PostCallData = z
  .object({
    conversation_id: z.string().optional(),
    agent_id: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    conversation_initiation_client_data: z.record(z.unknown()).optional(),
    transcript: z.array(TranscriptTurn).optional(),
    analysis: z
      .object({
        transcript_summary: z.string().optional(),
        call_successful: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const PostCallPayload = z
  .object({
    type: z.string().optional(),
    data: PostCallData.optional(),
  })
  .passthrough();

type PostCallDataT = z.infer<typeof PostCallData>;

/**
 * Search the known locations a Twilio CallSid might live in a
 * post_call_transcription payload. Returns undefined (never throws) when
 * none match — correlation falls back to elevenlabsConversationId.
 */
function extractCallSid(data: PostCallDataT): string | undefined {
  const metadata = data.metadata as Record<string, unknown> | undefined;

  const phoneCall = metadata?.phone_call as Record<string, unknown> | undefined;
  if (typeof phoneCall?.call_sid === 'string') return phoneCall.call_sid;

  if (typeof metadata?.call_sid === 'string') return metadata.call_sid;

  const initData = data.conversation_initiation_client_data as Record<string, unknown> | undefined;
  const dynamicVars = initData?.dynamic_variables as Record<string, unknown> | undefined;
  if (typeof dynamicVars?.system__call_sid === 'string') return dynamicVars.system__call_sid;
  if (typeof dynamicVars?.call_sid === 'string') return dynamicVars.call_sid;

  return undefined;
}

/** Flatten transcript turns into role-labeled lines, e.g. "AGENT: ...\nUSER: ...". */
function extractTranscriptText(
  transcript: Array<{ role?: string; message?: string | null }> | undefined,
): string | undefined {
  if (!transcript || transcript.length === 0) return undefined;
  const lines = transcript
    .filter((turn) => typeof turn.message === 'string' && turn.message.trim().length > 0)
    .map((turn) => `${(turn.role ?? 'unknown').toUpperCase()}: ${turn.message}`);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// Background work
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run LeadQualifier against the call's transcript and persist the
 * qualification columns, then hand off to the (currently stubbed) tenant
 * notification fan-out. Errors are swallowed and logged — the transcript is
 * already saved, so a qualification/notify failure shouldn't be retried by
 * ElevenLabs (this runs in `after()`, well past the response already sent).
 */
async function runQualificationAndNotify(call: Call): Promise<void> {
  const db = getDb();

  if (!call.transcript) {
    log.warn({ callId: call.id }, 'elevenlabs post-call: no transcript to qualify');
  } else {
    try {
      const site = (await db.select().from(sites).where(eq(sites.id, call.siteId)).limit(1))[0];
      if (!site) {
        log.warn({ callId: call.id, siteId: call.siteId }, 'lead-qualifier: site row missing');
      } else {
        const qualifier = new LeadQualifier();
        const result = await qualifier.run(
          {
            call_id: call.id,
            transcript: call.transcript,
            niche: site.niche,
            city: site.city,
            state: site.state,
            caller_number: call.callerNumber ?? undefined,
            duration_s: call.durationS ?? undefined,
          },
          { siteId: call.siteId },
        );

        const metadata: Record<string, unknown> = { ...(call.metadata as Record<string, unknown> | null) };
        metadata.qualification_summary = result.summary;
        metadata.qualification_confidence = result.confidence;
        if (result.notes) metadata.qualification_notes = result.notes;
        // Recording proxy (Phase D) reads calls.recordingUrl directly; flag
        // when it's not populated yet so the tenant email fan-out (once it
        // lands) knows to omit the recording link rather than send a dead one.
        if (!call.recordingUrl) metadata.recordingUrlPending = true;

        await db
          .update(calls)
          .set({
            classification: result.classification,
            qualificationScore: result.qualification_score,
            qualificationIntent: result.intent,
            qualificationUrgency: result.urgency,
            qualificationJobType: result.job_type,
            qualificationBudgetBand: result.budget_band ?? null,
            qualificationAddress: result.address ?? null,
            answeredBy: 'ai',
            metadata,
          })
          .where(eq(calls.id, call.id));

        log.info(
          { callId: call.id, score: result.qualification_score, classification: result.classification },
          'lead qualified',
        );
      }
    } catch (err) {
      log.error(
        { err: err instanceof Error ? err.message : err, callId: call.id },
        'lead qualification failed',
      );
    }
  }

  try {
    const notifyResult = await notifyTenantOfQualifiedLead(call.id);
    await db
      .update(calls)
      .set({ tenantSmsStatus: notifyResult.smsStatus, tenantEmailStatus: notifyResult.emailStatus })
      .where(eq(calls.id, call.id));
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : err, callId: call.id },
      'tenant notify fan-out failed',
    );
  }
}
