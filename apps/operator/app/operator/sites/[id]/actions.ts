'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, sites, calls, agentEvents, type Call, type Site } from '@leadlandlord/db';
import { updateNumber } from '@leadlandlord/integrations/twilio';
import {
  attachDomain as vercelAttachDomain,
  detachDomain as vercelDetachDomain,
  getDomainConfig,
  getDomainStatus,
} from '@leadlandlord/integrations/vercel';
import {
  createWriteClient,
  siteDocId,
  themeDocId,
  uploadHeroImage,
} from '@leadlandlord/integrations/sanity';
import { generateHeroImageBuffer } from '@leadlandlord/integrations/imagen';
import { CallClassifier } from '@leadlandlord/agents/call-classifier';
import { log } from '@leadlandlord/shared/log';
import { randomUUID } from 'node:crypto';

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

// ────────────────────────────────────────────────────────────────────────────
// Phase F — Sanity-backed actions on the site detail page
// ────────────────────────────────────────────────────────────────────────────

const ThemeName = z.enum(['classic', 'modern', 'premium', 'bright']);
type ThemeName = z.infer<typeof ThemeName>;

export interface ActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Swap the site's theme by patching the Sanity site doc's theme reference.
 * The site-host Vercel project picks up the change on its next per-request
 * Sanity fetch (Phase B uses no edge cache; ~Sanity-CDN-replication-lag for
 * propagation, currently ~5-30s).
 */
export async function setTheme(siteId: string, theme: ThemeName): Promise<ActionResult> {
  const parsed = ThemeName.safeParse(theme);
  if (!parsed.success) return { ok: false, message: 'invalid theme' };
  try {
    await createWriteClient()
      .patch(siteDocId(siteId))
      .set({ theme: { _ref: themeDocId(parsed.data), _type: 'reference' } })
      .commit({ visibility: 'sync' });
    revalidatePath(`/operator/sites/${siteId}`);
    revalidatePath('/operator/portfolio');
    log.info({ siteId, theme: parsed.data }, 'theme swapped');
    return { ok: true };
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err, siteId }, 'setTheme failed');
    return { ok: false, message: err instanceof Error ? err.message : 'theme swap failed' };
  }
}

/**
 * Update operator-controlled site config (GA4 ID, robots disallow flag,
 * primary domain selection). Patches the Sanity site doc; agents that
 * read these (sitemap.ts, robots.ts) pick up the change next request.
 */
export interface SiteConfigResult extends ActionResult {}
const SiteConfigSchema = z.object({
  site_id: z.string().uuid(),
  ga_measurement_id: z.string().optional(),
  robots_disallow: z.coerce.boolean().optional(),
  primary_host: z.string().optional(),
});

export async function setSiteConfig(formData: FormData): Promise<SiteConfigResult> {
  const parsed = SiteConfigSchema.safeParse({
    site_id: formData.get('site_id'),
    ga_measurement_id: nullable(formData.get('ga_measurement_id')),
    robots_disallow: nullable(formData.get('robots_disallow')),
    primary_host: nullable(formData.get('primary_host')),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const v = parsed.data;
  try {
    const client = createWriteClient();
    const set: Record<string, unknown> = {
      gaMeasurementId: emptyToNull(v.ga_measurement_id) ?? undefined,
      robotsDisallow: v.robots_disallow ?? false,
    };
    // If a primary_host was selected, mark exactly that one as isPrimary.
    if (v.primary_host) {
      // Read current domains, flip primary flags, write back.
      const current = await client.fetch<Array<{ host: string; isPrimary?: boolean; verified?: boolean; attachedAt?: string }>>(
        `*[_id==$id][0].domains`,
        { id: siteDocId(v.site_id) },
      );
      const next = (current ?? []).map((d) => ({
        ...d,
        _key: hostKey(d.host),
        _type: 'siteDomain' as const,
        isPrimary: d.host === v.primary_host,
      }));
      set.domains = next;
    }
    await client.patch(siteDocId(v.site_id)).set(set).commit({ visibility: 'sync' });
    revalidatePath(`/operator/sites/${v.site_id}`);
    revalidatePath('/operator/portfolio');
    return { ok: true };
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err, siteId: v.site_id }, 'setSiteConfig failed');
    return { ok: false, message: err instanceof Error ? err.message : 'config save failed' };
  }
}

/**
 * Attach a custom domain to the multi-tenant `leadlandlord-sites` Vercel
 * project AND record it in the Sanity site doc's `domains[]`. Returns the
 * DNS-instructions config so the operator can paste the right A/CNAME
 * records into their registrar.
 *
 * Idempotent — re-attaching the same host returns the existing record.
 */
export interface AttachDomainResult extends ActionResult {
  /** DNS records the operator needs to set at their registrar. */
  config?: {
    misconfigured: boolean;
    aValues?: string[];
    cnames?: string[];
  };
  /** Verification status from Vercel (includes verification[] challenges). */
  verified?: boolean;
}

const AttachDomainSchema = z.object({
  site_id: z.string().uuid(),
  host: z.string().min(3).max(253),
  is_primary: z.coerce.boolean().optional(),
});

export async function attachDomain(formData: FormData): Promise<AttachDomainResult> {
  const parsed = AttachDomainSchema.safeParse({
    site_id: formData.get('site_id'),
    host: formData.get('host'),
    is_primary: nullable(formData.get('is_primary')),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const v = parsed.data;

  const projectId = process.env.VERCEL_SITES_PROJECT_ID;
  if (!projectId) {
    return { ok: false, message: 'VERCEL_SITES_PROJECT_ID is not set on this operator deploy' };
  }

  // 1. Attach to Vercel.
  let attached;
  try {
    attached = await vercelAttachDomain(projectId, v.host);
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err, host: v.host }, 'vercel attach failed');
    return { ok: false, message: err instanceof Error ? err.message : 'vercel attach failed' };
  }

  // 2. Fetch DNS instructions (best-effort — a failure here doesn't undo step 1).
  let config: AttachDomainResult['config'];
  try {
    const cfg = await getDomainConfig(projectId, v.host);
    config = {
      misconfigured: cfg.misconfigured,
      aValues: cfg.aValues,
      cnames: cfg.cnames,
    };
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err, host: v.host }, 'domain config fetch failed');
  }

  // 3. Record in Sanity. Re-fetch current domains, append/replace this entry.
  try {
    const client = createWriteClient();
    const current = await client.fetch<Array<{ host: string; isPrimary?: boolean; verified?: boolean; attachedAt?: string }>>(
      `*[_id==$id][0].domains`,
      { id: siteDocId(v.site_id) },
    );
    const filtered = (current ?? []).filter((d) => d.host !== v.host);
    const newEntry = {
      _key: hostKey(v.host),
      _type: 'siteDomain' as const,
      host: v.host,
      isPrimary: v.is_primary ?? filtered.length === 0,
      verified: attached.verified,
      attachedAt: new Date().toISOString(),
    };
    const next = v.is_primary
      ? [newEntry, ...filtered.map((d) => ({ ...d, _key: hostKey(d.host), _type: 'siteDomain' as const, isPrimary: false }))]
      : [...filtered.map((d) => ({ ...d, _key: hostKey(d.host), _type: 'siteDomain' as const })), newEntry];
    await client.patch(siteDocId(v.site_id)).set({ domains: next }).commit({ visibility: 'sync' });
    log.info({ siteId: v.site_id, host: v.host, verified: attached.verified }, 'domain attached + recorded in sanity');
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err, host: v.host }, 'sanity domain record failed');
    // Vercel side is done; surface the partial-success to the operator.
    return {
      ok: true,
      verified: attached.verified,
      config,
      message: `Vercel attached, but Sanity write failed (${err instanceof Error ? err.message : 'unknown'}). Re-run to retry the Sanity side.`,
    };
  }

  revalidatePath(`/operator/sites/${v.site_id}`);
  revalidatePath('/operator/portfolio');
  return { ok: true, verified: attached.verified, config };
}

const DetachDomainSchema = z.object({
  site_id: z.string().uuid(),
  host: z.string().min(3).max(253),
});

export async function detachDomain(formData: FormData): Promise<ActionResult> {
  const parsed = DetachDomainSchema.safeParse({
    site_id: formData.get('site_id'),
    host: formData.get('host'),
  });
  if (!parsed.success) return { ok: false, message: 'invalid input' };
  const v = parsed.data;
  const projectId = process.env.VERCEL_SITES_PROJECT_ID;
  if (!projectId) return { ok: false, message: 'VERCEL_SITES_PROJECT_ID is not set' };

  try {
    await vercelDetachDomain(projectId, v.host);
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err, host: v.host }, 'vercel detach failed (continuing to Sanity cleanup)');
  }
  try {
    const client = createWriteClient();
    const current = await client.fetch<Array<{ host: string; isPrimary?: boolean; verified?: boolean; attachedAt?: string }>>(
      `*[_id==$id][0].domains`,
      { id: siteDocId(v.site_id) },
    );
    const next = (current ?? [])
      .filter((d) => d.host !== v.host)
      .map((d) => ({ ...d, _key: hostKey(d.host), _type: 'siteDomain' as const }));
    await client.patch(siteDocId(v.site_id)).set({ domains: next }).commit({ visibility: 'sync' });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'sanity update failed' };
  }
  revalidatePath(`/operator/sites/${v.site_id}`);
  revalidatePath('/operator/portfolio');
  return { ok: true };
}

const VerifyDomainSchema = z.object({
  site_id: z.string().uuid(),
  host: z.string().min(3).max(253),
});

/**
 * Force-poll Vercel for the latest verification status of a domain and patch
 * the Sanity site doc when it flips to verified. Same logic as the cron, but
 * triggered manually from the operator UI for one specific host.
 */
export async function verifyDomainNow(formData: FormData): Promise<ActionResult & { verified?: boolean }> {
  const parsed = VerifyDomainSchema.safeParse({
    site_id: formData.get('site_id'),
    host: formData.get('host'),
  });
  if (!parsed.success) return { ok: false, message: 'invalid input' };
  const v = parsed.data;
  const projectId = process.env.VERCEL_SITES_PROJECT_ID;
  if (!projectId) return { ok: false, message: 'VERCEL_SITES_PROJECT_ID is not set' };

  try {
    const status = await getDomainStatus(projectId, v.host);
    const client = createWriteClient();
    const current = await client.fetch<Array<{ host: string; isPrimary?: boolean; verified?: boolean; attachedAt?: string }>>(
      `*[_id==$id][0].domains`,
      { id: siteDocId(v.site_id) },
    );
    const next = (current ?? []).map((d) => ({
      ...d,
      _key: hostKey(d.host),
      _type: 'siteDomain' as const,
      verified: d.host === v.host ? status.verified : (d.verified ?? false),
    }));
    await client.patch(siteDocId(v.site_id)).set({ domains: next }).commit({ visibility: 'sync' });
    revalidatePath(`/operator/sites/${v.site_id}`);
    return { ok: true, verified: status.verified };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'verification poll failed' };
  }
}

/**
 * Re-generate just the hero image — useful when the operator wants a new
 * shot without re-running the whole content engine. Uses the existing
 * heroImagePrompt from the site doc.
 */
export async function regenerateHero(siteId: string): Promise<ActionResult & { heroImageUrl?: string }> {
  const client = createWriteClient();
  const promptDoc = await client.fetch<{ heroImagePrompt: string | null }>(
    `*[_id==$id][0]{ heroImagePrompt }`,
    { id: siteDocId(siteId) },
  );
  if (!promptDoc?.heroImagePrompt) {
    return { ok: false, message: 'no heroImagePrompt on site doc — re-run content first' };
  }
  try {
    const img = await generateHeroImageBuffer(promptDoc.heroImagePrompt);
    if (!img) {
      return { ok: false, message: 'no image provider configured (set GOOGLE_API_KEY or AI_GATEWAY_API_KEY)' };
    }
    const uploaded = await uploadHeroImage(siteId, img.buffer);
    await client
      .patch(siteDocId(siteId))
      .set({
        heroImage: { _type: 'image', asset: { _type: 'reference', _ref: uploaded.assetId } },
      })
      .commit({ visibility: 'sync' });
    revalidatePath(`/operator/sites/${siteId}`);
    return { ok: true, heroImageUrl: uploaded.url };
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err, siteId }, 'regenerateHero failed');
    return { ok: false, message: err instanceof Error ? err.message : 'hero regen failed' };
  }
}

/**
 * Enqueue a Site Builder re-run for this site. Doesn't run synchronously —
 * inserts an agent_event row that the next operator-tick cron will dispatch.
 * Site Builder is idempotent against Sanity (deterministic page IDs) so this
 * cleanly overwrites in place.
 */
export async function regenerateContent(siteId: string): Promise<ActionResult & { eventId?: string }> {
  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };
  const eventId = randomUUID();
  await db.insert(agentEvents).values({
    id: eventId,
    agent: 'operator-dashboard',
    type: 'site.regenerate-requested',
    targetAgent: 'site-builder',
    payload: {
      site_id: siteId,
      niche: site.niche,
      city: site.city,
      state: site.state,
      niche_id: site.nicheId ?? undefined,
      fast_mode: false,
    },
  });
  log.info({ siteId, eventId }, 'site regenerate enqueued');
  revalidatePath(`/operator/sites/${siteId}`);
  return { ok: true, eventId };
}

function hostKey(host: string): string {
  return host.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().slice(0, 63);
}
