'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  getDb,
  sites,
  calls,
  tenants,
  agentEvents,
  siteOriginalDataInputs,
  type Call,
  type Site,
} from '@leadlandlord/db';
import { updateNumber, releaseNumber } from '@leadlandlord/integrations/twilio';
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
import { requireOperatorSession } from '@/lib/auth';
import { randomUUID } from 'node:crypto';

const PhoneAssignmentSchema = z.object({
  site_id: z.string().uuid(),
  tracking_number: z.string().optional(),
  twilio_phone_sid: z.string().optional(),
  forwarding_number: z.string().optional(),
  whisper_message: z.string().optional(),
  inbound_greeting: z.string().optional(),
  recording_enabled: z.coerce.boolean().optional(),
  klaviyo_list_id: z.string().optional(),
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
    inbound_greeting: nullable(formData.get('inbound_greeting')),
    recording_enabled: nullable(formData.get('recording_enabled')),
    klaviyo_list_id: nullable(formData.get('klaviyo_list_id')),
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
      inboundGreeting: emptyToNull(v.inbound_greeting),
      recordingEnabled: v.recording_enabled ?? true,
      klaviyoListId: emptyToNull(v.klaviyo_list_id),
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

const ThemeName = z.enum(['classic', 'modern', 'premium', 'bright', 'haul', 'counsel']);
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

// ────────────────────────────────────────────────────────────────────────────
// Destructive — permanently delete a site and everything attached to it.
// ────────────────────────────────────────────────────────────────────────────

export interface DeleteSiteResult extends ActionResult {
  /** True when the delete was blocked because a live tenant is still attached. */
  blocked?: boolean;
  /** Non-fatal cleanup problems (Twilio/Vercel/Sanity) — the DB row was still deleted. */
  warnings?: string[];
}

/**
 * Hard-delete a site and ALL of its content:
 *   - Postgres `sites` row (cascades to prospects, calls, leads, trials,
 *     backlinks, and outreach events; agent_runs + suppression rows are
 *     orphaned via ON DELETE SET NULL for the audit trail).
 *   - Sanity site doc + every page doc + every keyword-cluster doc.
 *   - Releases the Twilio tracking number (stops the ~$1/mo charge).
 *   - Detaches all custom domains from the Vercel sites project.
 *
 * BLOCKS if a non-churned tenant is still attached — off-board the tenant
 * (and cancel their Stripe subscription) before deleting the site, so we never
 * nuke a revenue-generating site by accident.
 *
 * External cleanup is best-effort: a Twilio/Vercel/Sanity failure is reported
 * as a warning but does not abort the DB delete (the operator decided to kill
 * the site; we don't strand it half-deleted).
 */
export async function deleteSite(siteId: string): Promise<DeleteSiteResult> {
  if (!z.string().uuid().safeParse(siteId).success) {
    return { ok: false, message: 'invalid site id' };
  }

  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };

  // Guard: refuse to delete a site that still has a live tenant.
  const liveTenants = await db
    .select({ id: tenants.id, businessName: tenants.businessName, status: tenants.status })
    .from(tenants)
    .where(and(eq(tenants.siteId, siteId), ne(tenants.status, 'churned')));
  if (liveTenants.length > 0) {
    const names = liveTenants.map((t) => `${t.businessName} (${t.status})`).join(', ');
    return {
      ok: false,
      blocked: true,
      message: `Blocked: ${liveTenants.length} live tenant(s) still attached — ${names}. Off-board the tenant and cancel their Stripe subscription first.`,
    };
  }

  const warnings: string[] = [];

  // 1. Release the Twilio tracking number so we stop paying for it.
  if (site.twilioPhoneSid) {
    try {
      await releaseNumber(site.twilioPhoneSid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      warnings.push(`Twilio number ${site.twilioPhoneSid} not released: ${msg}`);
      log.warn({ err: msg, siteId, twilioSid: site.twilioPhoneSid }, 'deleteSite: twilio release failed');
    }
  }

  // 2. Detach custom domains from Vercel (best-effort, per host).
  const projectId = process.env.VERCEL_SITES_PROJECT_ID;
  try {
    const client = createWriteClient();
    const domains = await client.fetch<Array<{ host: string }>>(`*[_id==$id][0].domains`, {
      id: siteDocId(siteId),
    });
    if (projectId) {
      for (const d of domains ?? []) {
        try {
          await vercelDetachDomain(projectId, d.host);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown';
          warnings.push(`Domain ${d.host} not detached from Vercel: ${msg}`);
          log.warn({ err: msg, siteId, host: d.host }, 'deleteSite: vercel detach failed');
        }
      }
    } else if ((domains ?? []).length > 0) {
      warnings.push('VERCEL_SITES_PROJECT_ID not set — custom domains left attached in Vercel.');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    warnings.push(`Could not read domains for Vercel cleanup: ${msg}`);
  }

  // 3. Delete every Sanity doc belonging to this site (site + pages + clusters),
  //    drafts included, in a single transaction so reference constraints between
  //    pages and the site doc don't block the deletion.
  try {
    const client = createWriteClient();
    const ids = await client.fetch<string[]>(
      `*[_id == $siteDoc || (_type == "page" && site._ref == $siteDoc) || (_type == "keywordCluster" && siteId == $siteId)]._id`,
      { siteDoc: siteDocId(siteId), siteId },
    );
    const allIds = new Set<string>();
    for (const id of ids ?? []) {
      allIds.add(id);
      allIds.add(`drafts.${id.replace(/^drafts\./, '')}`);
    }
    if (allIds.size > 0) {
      let tx = client.transaction();
      for (const id of allIds) tx = tx.delete(id);
      await tx.commit({ visibility: 'async' });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    warnings.push(`Sanity content not fully deleted: ${msg}. Remove leftover docs in Studio.`);
    log.warn({ err: msg, siteId }, 'deleteSite: sanity delete failed');
  }

  // 4. Delete the DB row. FK cascades handle prospects, calls, leads, trials,
  //    backlinks, and outreach events; agent_runs + suppression rows are nulled.
  try {
    await db.delete(sites).where(eq(sites.id, siteId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    log.error({ err: msg, siteId }, 'deleteSite: db delete failed');
    return {
      ok: false,
      message: `External cleanup ran, but the database delete failed: ${msg}`,
      warnings,
    };
  }

  log.info({ siteId, warnings: warnings.length }, 'site deleted');
  revalidatePath('/operator/portfolio');
  revalidatePath('/operator/sites');
  return { ok: true, warnings: warnings.length ? warnings : undefined };
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 3f — Proprietary data inputs (GEO / original-content grounding)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse a JSON textarea into an array of plain objects. Empty/whitespace input
 * → []. Invalid JSON throws so the caller can surface a clear field-level error.
 */
function parseJsonArray(raw: string | undefined, field: string): Array<Record<string, unknown>> {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${field}: not valid JSON`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${field}: expected a JSON array`);
  return parsed.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
}

/**
 * Parse a JSON textarea into a plain object. Empty/whitespace input → {}.
 */
function parseJsonObject(raw: string | undefined, field: string): Record<string, unknown> {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${field}: not valid JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${field}: expected a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

const ProprietaryDataSchema = z.object({
  site_id: z.string().uuid(),
});

/**
 * Upsert the per-site `siteOriginalDataInputs` row (one row per site, enforced
 * by the `site_original_data_inputs_site_uniq` unique index). The agents read
 * these proprietary inputs from Postgres to ground non-commodity content
 * (case studies, firsthand reviews, contrarian takes, E-E-A-T bylines, sameAs).
 *
 * The five jsonb columns are captured as JSON textareas in the UI; the GBP URL
 * + socials are folded into `proprietaryFacts.sameAs` so the site renderer can
 * emit them as the org schema `sameAs[]`.
 *
 * `updatedBy` is set to 'operator' — the operator session is an opaque HMAC
 * cookie with no user identity, so there is no finer-grained actor to record.
 */
export async function saveProprietaryData(formData: FormData): Promise<ActionResult> {
  try {
    await requireOperatorSession();
  } catch {
    return { ok: false, message: 'unauthorized' };
  }
  const parsed = ProprietaryDataSchema.safeParse({ site_id: formData.get('site_id') });
  if (!parsed.success) return { ok: false, message: 'invalid site id' };
  const siteId = parsed.data.site_id;

  let caseStudyInputs: Array<Record<string, unknown>>;
  let firsthandInputs: Array<Record<string, unknown>>;
  let contrarianTakes: Array<Record<string, unknown>>;
  let proprietaryFacts: Record<string, unknown>;
  let expertiseProfile: Record<string, unknown>;
  try {
    caseStudyInputs = parseJsonArray(nullable(formData.get('case_study_inputs')), 'Case studies');
    firsthandInputs = parseJsonArray(nullable(formData.get('firsthand_inputs')), 'Firsthand notes');
    contrarianTakes = parseJsonArray(nullable(formData.get('contrarian_takes')), 'Contrarian takes');
    proprietaryFacts = parseJsonObject(nullable(formData.get('proprietary_facts')), 'Proprietary facts');
    expertiseProfile = parseJsonObject(nullable(formData.get('expertise_profile')), 'Expertise profile');
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'invalid JSON' };
  }

  // Fold the contractor's real GBP URL + social links into proprietaryFacts.sameAs.
  // These feed the rendered site's organization-schema `sameAs[]`.
  const gbpUrl = emptyToNull(nullable(formData.get('gbp_url')));
  const socials = (emptyToNull(nullable(formData.get('socials'))) ?? '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sameAs = [...(gbpUrl ? [gbpUrl] : []), ...socials];
  if (sameAs.length > 0) {
    proprietaryFacts = { ...proprietaryFacts, sameAs };
  }

  const db = getDb();
  const now = new Date();
  try {
    await db
      .insert(siteOriginalDataInputs)
      .values({
        siteId,
        caseStudyInputs,
        firsthandInputs,
        contrarianTakes,
        proprietaryFacts,
        expertiseProfile,
        updatedBy: 'operator',
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: siteOriginalDataInputs.siteId,
        set: {
          caseStudyInputs,
          firsthandInputs,
          contrarianTakes,
          proprietaryFacts,
          expertiseProfile,
          updatedBy: 'operator',
          updatedAt: now,
        },
      });
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : err, siteId },
      'saveProprietaryData failed',
    );
    return { ok: false, message: err instanceof Error ? err.message : 'save failed' };
  }

  // Sync sameAs to the Sanity site doc — the renderer reads `site.sameAs` from
  // Sanity (theme-bundle → LocalBusiness JSON-LD), NOT from Postgres, so
  // without this patch the URLs saved above never reach the live org schema.
  // persist-sanity carries the existing doc's sameAs forward across rebuilds,
  // so this value survives. Best-effort: a missing doc (site not built yet)
  // must not fail the save. An emptied form leaves the Sanity value untouched
  // (clearing real profile URLs is an explicit Studio action).
  let sameAsWarning: string | undefined;
  if (sameAs.length > 0) {
    try {
      const client = createWriteClient();
      await client.patch(siteDocId(siteId)).set({ sameAs }).commit();
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : err, siteId },
        'saveProprietaryData: sameAs Sanity sync failed (doc missing or write error)',
      );
      sameAsWarning =
        'Saved, but syncing sameAs to the live site failed (is the site built yet?). Re-save once the site exists.';
    }
  }

  revalidatePath(`/operator/sites/${siteId}`);
  return { ok: true, message: sameAsWarning };
}

export async function setLocalContentEnabled(siteId: string, enabled: boolean): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  if (!siteId) return { ok: false, message: 'missing site id' };
  const db = getDb();
  await db
    .update(sites)
    .set({ localContentEnabled: enabled, updatedAt: new Date() })
    .where(eq(sites.id, siteId));
  revalidatePath(`/operator/sites/${siteId}`);
  return { ok: true };
}

/**
 * Run keyword-planner against this site. Pulls fresh DataForSEO keywords +
 * re-clusters them. Operator clicks this when:
 *   - The site is brand new and never had clusters
 *   - Existing clusters are stale (90-day refresh)
 *   - Niche pivoted slightly and keywords need updating
 *
 * Async via agent_events queue — operator-tick claims and runs.
 */
export async function repullKeywords(siteId: string): Promise<ActionResult & { eventId?: string }> {
  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };
  const eventId = randomUUID();
  await db.insert(agentEvents).values({
    id: eventId,
    agent: 'operator-dashboard',
    type: 'keyword.repull-requested',
    targetAgent: 'keyword-planner',
    payload: {
      site_id: siteId,
      niche: site.niche,
      city: site.city,
      state: site.state,
    },
  });
  log.info({ siteId, eventId }, 'keyword-planner re-run enqueued');
  revalidatePath(`/operator/sites/${siteId}`);
  return { ok: true, eventId };
}

/**
 * Re-target content: re-runs Content Engine against the existing clusters
 * (skips keyword-planner). Operator clicks this when:
 *   - Clusters were just edited (added an operator keyword, retired a cluster)
 *   - Content drifted from the cluster shape and needs to snap back
 *
 * Cheaper than `regenerateContent` because it skips the keyword-planning
 * spend.
 */
export async function retargetContent(siteId: string): Promise<ActionResult & { eventId?: string }> {
  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };
  const eventId = randomUUID();
  await db.insert(agentEvents).values({
    id: eventId,
    agent: 'operator-dashboard',
    type: 'content.retarget-requested',
    targetAgent: 'site-builder',
    payload: {
      site_id: siteId,
      niche: site.niche,
      city: site.city,
      state: site.state,
      niche_id: site.nicheId ?? undefined,
      fast_mode: false,
      skip_keyword_planning: true,
    },
  });
  log.info({ siteId, eventId }, 'content re-target enqueued');
  revalidatePath(`/operator/sites/${siteId}`);
  return { ok: true, eventId };
}

/**
 * Generate (or regenerate) the keyword-rich long-form home intro for a single
 * site. Cheap, surgical path — runs Site Builder in `longform_only` mode, which
 * regenerates just the intro from existing clusters and patches `longformBody`
 * on the Sanity site doc. Page docs + the manual video fields are untouched.
 *
 * Used to backfill the long-form section onto sites built before the feature.
 * Async via the agent_events queue — operator-tick claims and runs it.
 */
export async function generateLongform(siteId: string): Promise<ActionResult & { eventId?: string }> {
  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };
  const eventId = randomUUID();
  await db.insert(agentEvents).values({
    id: eventId,
    agent: 'operator-dashboard',
    type: 'content.longform-requested',
    targetAgent: 'site-builder',
    payload: {
      site_id: siteId,
      niche: site.niche,
      city: site.city,
      state: site.state,
      niche_id: site.nicheId ?? undefined,
      longform_only: true,
    },
  });
  log.info({ siteId, eventId }, 'long-form generation enqueued');
  revalidatePath(`/operator/sites/${siteId}`);
  return { ok: true, eventId };
}
