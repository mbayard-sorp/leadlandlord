'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, sites, calls, type Call, type Site } from '@leadlandlord/db';
import { updateNumber } from '@leadlandlord/integrations/twilio';
import { CallClassifier } from '@leadlandlord/agents/call-classifier';
import { log } from '@leadlandlord/shared/log';

const PhoneAssignmentSchema = z.object({
  site_id: z.string().uuid(),
  tracking_number: z.string().optional(),
  twilio_phone_sid: z.string().optional(),
  forwarding_number: z.string().optional(),
  whisper_message: z.string().optional(),
  recording_enabled: z.coerce.boolean().optional(),
  klaviyo_list_id: z.string().optional(),
  ga_measurement_id: z.string().optional(),
});

export interface PhoneAssignmentResult {
  ok: boolean;
  message?: string;
  twilioUpdated?: boolean;
}

/**
 * Update a site's tracking-phone configuration. Always writes the DB row.
 * Additionally, if Twilio creds are configured AND the site has a
 * `twilio_phone_sid`, points the IncomingPhoneNumber's `VoiceUrl` at our
 * `/api/webhooks/twilio/voice` endpoint so Twilio sends inbound calls our way.
 */
export async function assignPhone(formData: FormData): Promise<PhoneAssignmentResult> {
  const parsed = PhoneAssignmentSchema.safeParse({
    site_id: formData.get('site_id'),
    tracking_number: nullable(formData.get('tracking_number')),
    twilio_phone_sid: nullable(formData.get('twilio_phone_sid')),
    forwarding_number: nullable(formData.get('forwarding_number')),
    whisper_message: nullable(formData.get('whisper_message')),
    recording_enabled: nullable(formData.get('recording_enabled')),
    klaviyo_list_id: nullable(formData.get('klaviyo_list_id')),
    ga_measurement_id: nullable(formData.get('ga_measurement_id')),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const v = parsed.data;

  const db = getDb();
  await db
    .update(sites)
    .set({
      trackingNumber: emptyToNull(v.tracking_number),
      twilioPhoneSid: emptyToNull(v.twilio_phone_sid),
      trackingProvider: v.twilio_phone_sid ? 'twilio' : v.tracking_number ? 'mock' : null,
      forwardingNumber: emptyToNull(v.forwarding_number),
      whisperMessage: emptyToNull(v.whisper_message),
      recordingEnabled: v.recording_enabled ?? true,
      klaviyoListId: emptyToNull(v.klaviyo_list_id),
      gaMeasurementId: emptyToNull(v.ga_measurement_id),
      updatedAt: new Date(),
    })
    .where(eq(sites.id, v.site_id));

  let twilioUpdated = false;
  if (
    v.twilio_phone_sid &&
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN
  ) {
    const baseUrl = process.env.OPERATOR_PUBLIC_URL ?? '';
    if (baseUrl) {
      try {
        await updateNumber({
          twilioSid: v.twilio_phone_sid,
          voiceUrl: `${baseUrl}/api/webhooks/twilio/voice`,
          statusCallbackUrl: `${baseUrl}/api/webhooks/twilio/status`,
          friendlyName: `LeadLandlord-${v.site_id.slice(0, 8)}`,
        });
        twilioUpdated = true;
      } catch (err) {
        log.error(
          { err: err instanceof Error ? err.message : err, twilioSid: v.twilio_phone_sid },
          'twilio updateNumber failed during phone assignment',
        );
        // Don't fail the whole action — DB row is updated, operator can retry.
        return {
          ok: true,
          twilioUpdated: false,
          message:
            'Saved locally, but Twilio update failed — check OPERATOR_PUBLIC_URL and Twilio creds.',
        };
      }
    }
  }

  revalidatePath(`/operator/sites/${v.site_id}`);
  revalidatePath('/operator/portfolio');
  return { ok: true, twilioUpdated };
}

const ManualCallSchema = z.object({
  site_id: z.string().uuid(),
  caller_number: z.string().min(3),
  duration_s: z.coerce.number().int().min(0).max(7200).optional(),
  classification: z
    .enum(['unclassified', 'won', 'quoted', 'lost', 'spam', 'no_voicemail'])
    .default('unclassified'),
  transcript: z.string().optional(),
});

/**
 * Insert a synthetic call row for testing the operator dashboard UI before
 * real Twilio webhooks land. Marked direction='inbound' and twilio_call_sid
 * is left null so we know it's a manual entry.
 */
export async function insertManualCall(formData: FormData): Promise<{ ok: boolean; message?: string }> {
  const parsed = ManualCallSchema.safeParse({
    site_id: formData.get('site_id'),
    caller_number: formData.get('caller_number'),
    duration_s: formData.get('duration_s') || undefined,
    classification: formData.get('classification') || 'unclassified',
    transcript: formData.get('transcript') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const v = parsed.data;

  const db = getDb();
  const inserted = (
    await db
      .insert(calls)
      .values({
        siteId: v.site_id,
        callerNumber: v.caller_number,
        direction: 'inbound',
        startedAt: new Date(),
        durationS: v.duration_s,
        classification: v.classification,
        transcript: v.transcript,
        metadata: { manual_entry: true },
      })
      .returning()
  )[0];

  // If the user pasted a transcript and didn't pre-classify the call, run the
  // LLM classifier in the background — useful for testing the pipeline without
  // a live Twilio webhook.
  if (inserted && v.transcript && v.classification === 'unclassified') {
    const site = (await db.select().from(sites).where(eq(sites.id, v.site_id)).limit(1))[0];
    if (site) {
      after(() => classifyManualCall(inserted, site));
    }
  }

  revalidatePath(`/operator/sites/${v.site_id}`);
  revalidatePath('/operator/calls');
  return { ok: true };
}

async function classifyManualCall(call: Call, site: Site): Promise<void> {
  if (!call.transcript) return;
  try {
    const classifier = new CallClassifier();
    const result = await classifier.run(
      {
        call_id: call.id,
        transcript: call.transcript,
        niche: site.niche,
        city: site.city,
        state: site.state,
        caller_number: call.callerNumber ?? undefined,
        duration_s: call.durationS ?? undefined,
      },
      { siteId: site.id },
    );
    const db = getDb();
    await db
      .update(calls)
      .set({
        classification: result.classification,
        estRevenueUsd: result.est_revenue_usd != null ? result.est_revenue_usd.toFixed(2) : null,
        metadata: {
          ...(call.metadata as Record<string, unknown> | null),
          classification_summary: result.summary,
          classification_confidence: result.confidence,
          classification_notes: result.notes,
        },
      })
      .where(eq(calls.id, call.id));
    revalidatePath(`/operator/sites/${site.id}`);
    revalidatePath('/operator/calls');
    log.info(
      {
        callId: call.id,
        classification: result.classification,
        confidence: result.confidence,
      },
      'manual call classified',
    );
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : err, callId: call.id },
      'classify manual call failed',
    );
  }
}

function nullable(v: FormDataEntryValue | null): string | undefined {
  if (v === null) return undefined;
  if (typeof v !== 'string') return undefined;
  return v;
}

function emptyToNull(v: string | undefined): string | null {
  if (v === undefined) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}
