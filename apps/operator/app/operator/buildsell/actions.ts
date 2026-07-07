'use server';

import { revalidatePath } from 'next/cache';
import { eq, isNotNull, sql } from 'drizzle-orm';
import {
  getDb,
  buildsellSites,
  agentEvents,
  upsertLeadCrm,
  fetchLeadCrmByPlaceIds,
  fetchFreshBuildsellLeads,
  type LeadSnapshot,
} from '@leadlandlord/db';
import {
  PENDING_MIGRATION_KEY,
  type MigrationSelections,
} from '@leadlandlord/agents/content-migrator/types';
import { searchLeads } from '@leadlandlord/integrations/google-places';
import { sendEmail } from '@leadlandlord/integrations/resend';
import {
  attachDomain as vercelAttachDomain,
  detachDomain as vercelDetachDomain,
  getDomainConfig,
  getDomainStatus,
} from '@leadlandlord/integrations/vercel';
import { createWriteClient, uploadHeroImage } from '@leadlandlord/integrations/sanity';
import { generateHeroImageBuffer } from '@leadlandlord/integrations/imagen';
import { generateAndUploadFavicon } from '@leadlandlord/integrations/favicon';
import { presetByName } from '@leadlandlord/sanity-schema/presets';
import { buildsellSiteDocId } from '@leadlandlord/sanity-schema/ids';
import { buildInvoicePdf } from '@/lib/buildsell-invoice';
import { requireOperatorSession } from '@/lib/auth';
import { log } from '@leadlandlord/shared/log';
import type { SearchLead } from './types';

// ─── Search ──────────────────────────────────────────────────────────────────

interface SearchResult {
  ok: boolean;
  leads?: SearchLead[];
  message?: string;
}

/** YYYY-MM-DD from a Date (or null). */
function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * Ephemeral Places search. searchLeads writes nothing (read-only); we overlay
 * the operator's saved CRM state (called / note / follow-up) by place_id so a
 * fresh search still shows which leads have already been worked.
 */
export async function runBuildSellSearch(formData: FormData): Promise<SearchResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const trade = String(formData.get('trade') ?? '').trim();
  const city  = String(formData.get('city')  ?? '').trim();
  const state = String(formData.get('state') ?? '').trim().toUpperCase();
  const countRaw = formData.get('count');
  const count = countRaw ? Math.min(50, Math.max(1, Number(countRaw))) : 20;

  if (!trade) return { ok: false, message: 'Trade is required.' };
  if (!city)  return { ok: false, message: 'City is required.' };
  if (state.length !== 2) return { ok: false, message: 'State must be a two-letter code (e.g. AZ).' };

  try {
    const results = await searchLeads({ trade, city, state, count });
    const overlay = await fetchLeadCrmByPlaceIds(results.map((r) => r.placeId));
    const leads: SearchLead[] = results.map((r) => {
      const crm = overlay.get(r.placeId);
      return {
        ...r,
        called: crm?.called ?? false,
        calledAt: crm?.calledAt ? crm.calledAt.toISOString() : null,
        note: crm?.note ?? null,
        followUpAt: isoDate(crm?.followUpAt ?? null),
      };
    });
    return { ok: true, leads };
  } catch (err) {
    log.error({ trade, city, state, err }, 'runBuildSellSearch failed');
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Lead CRM (lazy-persist on first interaction) ─────────────────────────────

/** Pull the Places snapshot the client carries on each lead card. */
function snapshotFromForm(fd: FormData): LeadSnapshot {
  const numOr = (k: string): number | null => {
    const v = fd.get(k);
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const strOr = (k: string): string | null => {
    const v = fd.get(k);
    return v == null || v === '' ? null : String(v);
  };
  return {
    displayName: strOr('display_name'),
    formattedAddress: strOr('formatted_address'),
    nationalPhone: strOr('national_phone'),
    primaryType: strOr('primary_type'),
    rating: numOr('rating'),
    userRatingCount: numOr('user_rating_count'),
    websiteUri: strOr('website_uri'),
    lat: numOr('lat'),
    lng: numOr('lng'),
    trade: strOr('trade'),
    city: strOr('city'),
    state: strOr('state'),
  };
}

interface CrmResult {
  ok: boolean;
  message?: string;
  called?: boolean;
  calledAt?: string | null;
  note?: string | null;
  followUpAt?: string | null;
}

/** Toggle the Called flag; stamps called_at when set, clears it when unset. */
export async function markCalled(formData: FormData): Promise<CrmResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  const placeId = String(formData.get('place_id') ?? '').trim();
  if (!placeId) return { ok: false, message: 'Missing place id.' };
  const called = String(formData.get('called') ?? '') === 'true';
  const calledAt = called ? new Date() : null;
  try {
    await upsertLeadCrm(placeId, snapshotFromForm(formData), { called, calledAt });
    revalidatePath('/operator/buildsell');
    return { ok: true, called, calledAt: calledAt ? calledAt.toISOString() : null };
  } catch (err) {
    log.error({ placeId, err }, 'markCalled failed');
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Save (or clear) the operator's note on a lead. */
export async function saveLeadNote(formData: FormData): Promise<CrmResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  const placeId = String(formData.get('place_id') ?? '').trim();
  if (!placeId) return { ok: false, message: 'Missing place id.' };
  const raw = String(formData.get('note') ?? '').trim();
  const note = raw === '' ? null : raw.slice(0, 4000);
  try {
    await upsertLeadCrm(placeId, snapshotFromForm(formData), { note });
    revalidatePath('/operator/buildsell');
    return { ok: true, note };
  } catch (err) {
    log.error({ placeId, err }, 'saveLeadNote failed');
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Set (or clear) a follow-up date (YYYY-MM-DD). */
export async function setFollowUp(formData: FormData): Promise<CrmResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  const placeId = String(formData.get('place_id') ?? '').trim();
  if (!placeId) return { ok: false, message: 'Missing place id.' };
  const raw = String(formData.get('follow_up_at') ?? '').trim();
  // Parse YYYY-MM-DD at UTC midnight; empty clears the follow-up.
  const followUpAt = raw ? new Date(`${raw}T00:00:00.000Z`) : null;
  if (raw && Number.isNaN(followUpAt?.getTime())) {
    return { ok: false, message: 'Invalid date.' };
  }
  try {
    await upsertLeadCrm(placeId, snapshotFromForm(formData), { followUpAt });
    revalidatePath('/operator/buildsell');
    return { ok: true, followUpAt: followUpAt ? followUpAt.toISOString().slice(0, 10) : null };
  } catch (err) {
    log.error({ placeId, err }, 'setFollowUp failed');
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Build draft ─────────────────────────────────────────────────────────────

interface BuildDraftResult {
  ok: boolean;
  message?: string;
  buildsellSiteId?: string;
}

/**
 * Create a buildsell_sites row (status='draft') and enqueue a
 * buildsell.build event for spec-site-builder.
 *
 * NAP (phone + address) is fetched from the 30-day Places cache (if still
 * fresh) and written ONLY into the agent-event payload — never into a new
 * Postgres column. The spec-site-builder reads them transiently and writes
 * them into Sanity. Aggregate rating/userRatingCount/primaryType are NOT
 * PII and go into metadata as before.
 */
export async function buildDraft(formData: FormData): Promise<BuildDraftResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const businessName    = String(formData.get('business_name')     ?? '').trim();
  const trade           = String(formData.get('trade')             ?? '').trim();
  const city            = String(formData.get('city')              ?? '').trim();
  const state           = String(formData.get('state')             ?? '').trim().toUpperCase();
  const placeId         = String(formData.get('place_id')          ?? '').trim() || null;
  const ownerEmail      = String(formData.get('owner_email')       ?? '').trim() || null;
  const ratingRaw       = String(formData.get('rating')            ?? '').trim();
  const ratingCountRaw  = String(formData.get('user_rating_count') ?? '').trim();
  const primaryType     = String(formData.get('primary_type')      ?? '').trim() || null;

  // Form snapshot: the client passes these along on the build form so the
  // operator's current search result supplies NAP even if not yet in DB.
  const formPhone   = String(formData.get('national_phone')      ?? '').trim() || null;
  const formAddress = String(formData.get('formatted_address')   ?? '').trim() || null;

  if (!businessName) return { ok: false, message: 'Business name is required.' };
  if (!trade)        return { ok: false, message: 'Trade is required.' };
  if (!city)         return { ok: false, message: 'City is required.' };
  if (state.length !== 2) return { ok: false, message: 'State must be a two-letter code.' };

  // Aggregate signal fields into metadata (non-PII, survives reaper).
  const rating         = ratingRaw       ? parseFloat(ratingRaw)       : null;
  const userRatingCount = ratingCountRaw ? parseInt(ratingCountRaw, 10) : null;
  const metadata: Record<string, unknown> = {};
  if (rating != null && !isNaN(rating))              metadata.rating          = rating;
  if (userRatingCount != null && !isNaN(userRatingCount)) metadata.userRatingCount = userRatingCount;
  if (primaryType)                                   metadata.primaryType     = primaryType;

  // Resolve NAP: prefer fresh cache row over form snapshot (cache is always
  // more authoritative; form snapshot is the fallback when the lead hasn't
  // been cached yet or when the operator builds immediately after search).
  let phone   = formPhone;
  let address = formAddress;
  if (placeId) {
    try {
      const cached = await fetchFreshBuildsellLeads([placeId]);
      const hit = cached[0];
      if (hit) {
        phone   = hit.nationalPhone   ?? phone;
        address = hit.formattedAddress ?? address;
      }
    } catch (err) {
      // Non-fatal: proceed with form snapshot.
      log.warn({ placeId, err }, 'buildDraft: cache lookup failed — using form snapshot NAP');
    }
  }

  const buildEpoch = Date.now().toString();
  const db = getDb();

  const [row] = await db
    .insert(buildsellSites)
    .values({
      businessName, trade, city, state, placeId, ownerEmail, buildEpoch,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
    })
    .returning({ id: buildsellSites.id });

  if (!row) return { ok: false, message: 'Insert failed — no row returned.' };

  // NAP travels transiently in the event payload only — no new Postgres columns,
  // no migration, reaper untouched. Spec-site-builder writes phone/address into
  // the Sanity doc and discards the payload.
  const eventPayload: Record<string, unknown> = {
    buildsell_site_id: row.id,
    build_epoch: buildEpoch,
  };
  if (phone)   eventPayload.phone        = phone;
  if (address) eventPayload.address_line = address;

  try {
    await db.insert(agentEvents).values({
      agent: 'operator',
      type: 'buildsell.build',
      targetAgent: 'spec-site-builder',
      payload: eventPayload,
    });
  } catch (err) {
    log.error({ id: row.id, err }, 'buildDraft: agent event insert failed');
    revalidatePath('/operator/buildsell');
    return {
      ok: false,
      message: `Site row created (${row.id}) but build event failed to enqueue: ${err instanceof Error ? err.message : String(err)}`,
      buildsellSiteId: row.id,
    };
  }

  log.info({ id: row.id, businessName, trade, city }, 'buildDraft: site row + build event created');

  // Drain immediately so spec-site-builder starts now instead of waiting up to
  // a tick for the cron. Same pattern as requestDomainSearch in
  // sites/[id]/domain-actions.ts: runOperatorTick claims the event and dispatches
  // the agent in a background waitUntil, so it returns quickly. Lazy import to
  // avoid pulling the agent registry at module init. Non-fatal — the cron is the
  // fallback if the inline drain fails.
  try {
    const { runOperatorTick } = await import('@/lib/operator-tick');
    await runOperatorTick();
  } catch (err) {
    log.warn(
      { id: row.id, err: err instanceof Error ? err.message : err },
      'buildDraft: inline operator-tick failed — cron will pick up the build event',
    );
  }

  revalidatePath('/operator/buildsell');
  return { ok: true, buildsellSiteId: row.id };
}

// ─── Send invoice ─────────────────────────────────────────────────────────────

interface SendInvoiceResult {
  ok: boolean;
  message?: string;
}

/**
 * Assign an invoice number (BS-NNNN, sequential), persist price/link, build
 * the PDF via react-pdf, and email it via Resend.
 *
 * Re-send is allowed when status is 'draft' or 'invoiced'.
 */
export async function sendInvoice(formData: FormData): Promise<SendInvoiceResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const id         = String(formData.get('id')           ?? '').trim();
  const priceUsd   = String(formData.get('price_usd')    ?? '').trim();
  const paymentLink = String(formData.get('payment_link') ?? '').trim();

  if (!id)          return { ok: false, message: 'Missing site id.' };
  if (!priceUsd)    return { ok: false, message: 'Price is required.' };
  if (!paymentLink) return { ok: false, message: 'Payment link is required.' };

  const fromAddress = process.env.RESEND_FROM_ADDRESS;
  if (!fromAddress) return { ok: false, message: 'RESEND_FROM_ADDRESS env var is not set.' };

  const db = getDb();

  const [existing] = await db
    .select()
    .from(buildsellSites)
    .where(eq(buildsellSites.id, id))
    .limit(1);

  if (!existing) return { ok: false, message: 'Site not found.' };
  if (existing.status !== 'draft' && existing.status !== 'invoiced') {
    return { ok: false, message: `Cannot send invoice when status is '${existing.status}'.` };
  }
  if (!existing.ownerEmail) {
    return { ok: false, message: 'Site has no owner email — set it before sending an invoice.' };
  }

  // Assign invoice number if not already set (BS-NNNN, retry on unique violation).
  let invoiceNumber = existing.invoiceNumber;
  if (!invoiceNumber) {
    invoiceNumber = await assignInvoiceNumber(db, id);
    if (!invoiceNumber) {
      return { ok: false, message: 'Failed to assign a unique invoice number after retries.' };
    }
  }

  // Persist price, paymentLink, invoiceNumber before building the PDF.
  const [updated] = await db
    .update(buildsellSites)
    .set({ priceUsd, paymentLink, invoiceNumber })
    .where(eq(buildsellSites.id, id))
    .returning();

  if (!updated) return { ok: false, message: 'Failed to update site row.' };

  // Build the PDF.
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await buildInvoicePdf(updated);
  } catch (err) {
    log.error({ id, err }, 'sendInvoice: PDF build failed');
    return { ok: false, message: `PDF build failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Send the email.
  try {
    await sendEmail({
      to: existing.ownerEmail,
      from: fromAddress,
      subject: `Your website invoice — ${invoiceNumber}`,
      text: [
        `Hi ${existing.businessName},`,
        '',
        `Please find your invoice (${invoiceNumber}) attached for your new website.`,
        '',
        `Amount due: $${Number(priceUsd).toFixed(2)}`,
        '',
        `Pay online here: ${paymentLink}`,
        '',
        'Questions? Just reply to this email.',
      ].join('\n'),
      attachments: [
        { filename: `invoice-${invoiceNumber}.pdf`, content: pdfBuffer },
      ],
    });
  } catch (err) {
    log.error({ id, invoiceNumber, err }, 'sendInvoice: email send failed');
    return { ok: false, message: `Email send failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Flip status to invoiced.
  await db
    .update(buildsellSites)
    .set({ status: 'invoiced', invoiceSentAt: new Date() })
    .where(eq(buildsellSites.id, id));

  // Best-effort: write purchaseUrl into the Sanity doc so DraftShield can
  // surface it immediately. The email already went out; a Sanity failure must
  // NOT abort or surface an error to the operator.
  const docId = buildsellSiteDocId(id);
  try {
    await createWriteClient()
      .patch(docId)
      .set({ purchaseUrl: paymentLink })
      .commit({ visibility: 'async' });
    log.info({ id, docId }, 'sendInvoice: purchaseUrl patched into Sanity');
  } catch (err) {
    log.warn({ id, docId, err }, 'sendInvoice: Sanity purchaseUrl patch failed (non-fatal — email sent)');
  }

  log.info({ id, invoiceNumber, to: existing.ownerEmail }, 'sendInvoice: invoice emailed');
  revalidatePath('/operator/buildsell');
  return { ok: true, message: `Invoice ${invoiceNumber} sent to ${existing.ownerEmail}.` };
}

// ─── Invoice number helper ────────────────────────────────────────────────────

/**
 * Assign a sequential BS-NNNN invoice number to a buildsell_sites row.
 * On unique-constraint violation (concurrent assign), retries up to 5 times.
 * Returns the assigned number, or null if all retries fail.
 */
async function assignInvoiceNumber(
  db: ReturnType<typeof getDb>,
  siteId: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const countResult = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(buildsellSites)
      .where(isNotNull(buildsellSites.invoiceNumber));
    const n = countResult[0]?.n ?? 0;
    const candidate = `BS-${String(n + 1 + attempt).padStart(4, '0')}`;

    try {
      await db
        .update(buildsellSites)
        .set({ invoiceNumber: candidate })
        .where(eq(buildsellSites.id, siteId));
      return candidate;
    } catch (err) {
      // Unique violation — another row got that number. Try next.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('unique') && !msg.includes('duplicate')) throw err;
      log.warn({ siteId, candidate, attempt }, 'assignInvoiceNumber: collision, retrying');
    }
  }
  return null;
}

// ─── Mark paid + go live ─────────────────────────────────────────────────────

interface MarkPaidResult {
  ok: boolean;
  message?: string;
  slug?: string | null;
}

/**
 * Shared go-live routine: patches the Sanity doc to clear draftMode and
 * robotsDisallow so the public site becomes crawlable, flips the Postgres row
 * to 'live', and (best-effort) provisions customer portal access.
 *
 * Sanity is patched FIRST since it's the less-reliable write; if it fails the
 * DB row is left unchanged so the operator can retry — never a 'live' row
 * pointing at a still-watermarked, noindexed Sanity doc.
 */
async function goLiveSite(
  existing: typeof buildsellSites.$inferSelect,
  grantedBy: 'operator' | 'auto-markpaid',
  logTag: string,
): Promise<MarkPaidResult> {
  const db = getDb();
  const id = existing.id;

  const docId = buildsellSiteDocId(id);
  try {
    await createWriteClient()
      .patch(docId)
      .set({ draftMode: false, robotsDisallow: false })
      .commit({ visibility: 'sync' });
  } catch (err) {
    log.error({ id, docId, err }, `${logTag}: Sanity patch failed — leaving status unchanged`);
    revalidatePath('/operator/buildsell');
    return {
      ok: false,
      message: `Sanity patch failed (site NOT marked live — safe to retry): ${err instanceof Error ? err.message : String(err)}`,
      slug: existing.slug,
    };
  }

  // Sanity is now indexable — commit the DB go-live.
  const now = new Date();
  await db
    .update(buildsellSites)
    .set({ status: 'live', paidAt: now, liveAt: now })
    .where(eq(buildsellSites.id, id));

  log.info({ id, slug: existing.slug }, `${logTag}: site marked live`);

  // Non-fatal: provision customer portal access. A failure here MUST NOT
  // change the return value or block go-live. The operator can manually grant
  // access via the CustomerAccessPanel if this fails.
  try {
    if (existing.ownerEmail) {
      const { provisionCustomerAccess } = await import('@leadlandlord/integrations/neon-auth');
      await provisionCustomerAccess({
        ownerEmail: existing.ownerEmail,
        businessName: existing.businessName,
        siteId: id,
        grantedBy,
      });
    }
  } catch (err) {
    log.warn({ id, err }, `${logTag}: customer access provisioning failed (non-fatal)`);
  }

  revalidatePath('/operator/buildsell');

  return {
    ok: true,
    message: `Site is now live${existing.slug ? ` at /buildsell/${existing.slug}` : ''}.`,
    slug: existing.slug,
  };
}

/**
 * Mark a site as paid + live. Guard: only proceeds when status is 'invoiced'
 * or 'paid' (idempotent re-run) — i.e. an invoice has already gone out.
 */
export async function markPaid(formData: FormData): Promise<MarkPaidResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { ok: false, message: 'Missing site id.' };

  const db = getDb();

  const [existing] = await db
    .select()
    .from(buildsellSites)
    .where(eq(buildsellSites.id, id))
    .limit(1);

  if (!existing) return { ok: false, message: 'Site not found.' };
  if (existing.status !== 'invoiced' && existing.status !== 'paid') {
    return { ok: false, message: 'Send an invoice first.' };
  }

  return goLiveSite(existing, 'auto-markpaid', 'markPaid');
}

/**
 * Operator override: go live without sending an invoice first (no payment
 * collected). For sites sold/handled outside the in-app invoice flow.
 *
 * Guard: only from 'draft', 'invoiced', or 'paid' — never mid-build
 * ('building'), never a broken build ('failed'), and it's a no-op re-run
 * guard against 'live' (use the domain/customer-access panels instead once
 * a site is already live).
 */
export async function forceLiveBuildSellSite(formData: FormData): Promise<MarkPaidResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { ok: false, message: 'Missing site id.' };

  const db = getDb();

  const [existing] = await db
    .select()
    .from(buildsellSites)
    .where(eq(buildsellSites.id, id))
    .limit(1);

  if (!existing) return { ok: false, message: 'Site not found.' };
  if (existing.status === 'building') return { ok: false, message: 'Site is still building.' };
  if (existing.status === 'failed') return { ok: false, message: 'Build failed — retry the build first.' };
  if (existing.status === 'live') return { ok: false, message: 'Site is already live.' };

  return goLiveSite(existing, 'operator', 'forceLiveBuildSellSite');
}

// ─── Custom domain attach ────────────────────────────────────────────────────

export interface AttachDomainResult {
  ok: boolean;
  message?: string;
  /** DNS records for the operator to hand the customer at their registrar. */
  dns?: {
    aValues: string[];
    cnames: string[];
  };
}

// Bare apex only: no scheme, no path, no leading "www." (www is derived and
// attached alongside the apex — see below).
const BARE_HOSTNAME_RE =
  /^(?!www\.)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * Attach the customer's own domain (bare apex, e.g. "tesshauling.com") to the
 * site-host Vercel project and record it on both Postgres and the Sanity doc
 * so Host-header resolution (fetchBuildSellSiteByHost) picks it up.
 *
 * Attaches both the apex and the `www` subdomain — apex is primary; www
 * attach is best-effort since most customers only need the apex to work.
 * Idempotent: re-running with the same domain re-attaches (Vercel no-ops)
 * and re-syncs Postgres/Sanity.
 *
 * Guard: only proceeds once the sale is in flight (invoiced/paid/live) —
 * attaching a real domain to a draft site nobody has committed to buy yet
 * doesn't make sense.
 *
 * This does NOT flip the site's own sold status — that's markPaid. Domain
 * attach and mark-paid are independent operator steps; do either first.
 */
export async function attachBuildSellDomain(formData: FormData): Promise<AttachDomainResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const id = String(formData.get('id') ?? '').trim();
  const rawDomain = String(formData.get('domain') ?? '').trim().toLowerCase();
  if (!id) return { ok: false, message: 'Missing site id.' };

  // Forgive a pasted URL or trailing slash/dot; still require a bare apex.
  const domain = rawDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!BARE_HOSTNAME_RE.test(domain)) {
    return {
      ok: false,
      message: 'Enter the bare domain the customer owns (e.g. "tesshauling.com") — not a URL, and not "www.".',
    };
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(buildsellSites)
    .where(eq(buildsellSites.id, id))
    .limit(1);

  if (!existing) return { ok: false, message: 'Site not found.' };
  if (existing.status !== 'invoiced' && existing.status !== 'paid' && existing.status !== 'live') {
    return { ok: false, message: 'Send an invoice (or mark paid) before attaching a domain.' };
  }

  const projectId = process.env.VERCEL_SITES_PROJECT_ID;
  if (!projectId) {
    return { ok: false, message: 'VERCEL_SITES_PROJECT_ID is not set on this operator deploy.' };
  }

  // 1. Attach the apex to Vercel first — this is the call that must succeed.
  try {
    await vercelAttachDomain(projectId, domain);
  } catch (err) {
    log.error({ id, domain, err }, 'attachBuildSellDomain: vercel attach (apex) failed');
    return { ok: false, message: err instanceof Error ? err.message : 'Vercel attach failed.' };
  }

  // 2. Attach www too — best-effort, non-fatal (the apex is what matters).
  try {
    await vercelAttachDomain(projectId, `www.${domain}`);
  } catch (err) {
    log.warn({ id, domain, err }, 'attachBuildSellDomain: vercel attach (www) failed (non-fatal)');
  }

  // 3. Fetch DNS instructions — best-effort. Fall back to Vercel's documented
  // defaults (same ones used for R&R domain attach) if the config call fails;
  // the attach itself already succeeded either way.
  let dns: AttachDomainResult['dns'] = { aValues: ['76.76.21.21'], cnames: ['cname.vercel-dns.com'] };
  try {
    const cfg = await getDomainConfig(projectId, domain);
    dns = {
      aValues: cfg.aValues?.length ? cfg.aValues : dns.aValues,
      cnames: cfg.cnames?.length ? cfg.cnames : dns.cnames,
    };
  } catch (err) {
    log.warn({ id, domain, err }, 'attachBuildSellDomain: domain config fetch failed — using documented defaults');
  }

  // 4. Record on the Postgres row. Unique constraint on custom_domain means
  // this fails loudly if the domain is already attached to a different site.
  try {
    await db
      .update(buildsellSites)
      .set({ customDomain: domain, domainStatus: 'pending', domainAttachedAt: new Date() })
      .where(eq(buildsellSites.id, id));
  } catch (err) {
    log.error({ id, domain, err }, 'attachBuildSellDomain: db update failed');
    return {
      ok: false,
      dns,
      message: `Vercel attach succeeded, but saving the domain failed (it may already be attached to another site): ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 5. Mirror onto the Sanity doc so fetchBuildSellSiteByHost can resolve it.
  try {
    await createWriteClient()
      .patch(buildsellSiteDocId(id))
      .set({ customDomain: domain })
      .commit({ visibility: 'sync' });
  } catch (err) {
    log.error({ id, domain, err }, 'attachBuildSellDomain: sanity patch failed — DB has the domain, Sanity does not yet');
    revalidatePath('/operator/buildsell');
    return {
      ok: true,
      dns,
      message: `Domain attached and saved, but the Sanity write failed — the site will NOT resolve on the domain until this succeeds (safe to re-run): ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  log.info({ id, domain }, 'attachBuildSellDomain: domain attached');
  revalidatePath('/operator/buildsell');
  revalidatePath(`/operator/buildsell/${id}`);

  return { ok: true, dns };
}

interface DetachDomainResult {
  ok: boolean;
  message?: string;
}

/**
 * Detach the site's custom domain. Always allowed (no status guard) — a
 * customer switching or dropping a domain shouldn't be blocked by sale state.
 *
 * Fully nulls the Postgres row (customDomain/domainStatus/domainAttachedAt/
 * domainVerifiedAt) — not just the Sanity mirror — because `custom_domain`
 * is unique; leaving it set on this row would block a customer from
 * re-attaching the same domain to a different site.
 *
 * The Sanity unset happens synchronously (not best-effort) since removing
 * the mirror is what stops Host-header resolution from finding this site
 * under the old domain.
 */
export async function detachBuildSellDomain(formData: FormData): Promise<DetachDomainResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { ok: false, message: 'Missing site id.' };

  const db = getDb();
  const [existing] = await db
    .select()
    .from(buildsellSites)
    .where(eq(buildsellSites.id, id))
    .limit(1);

  if (!existing) return { ok: false, message: 'Site not found.' };
  if (!existing.customDomain) return { ok: false, message: 'No domain attached.' };

  const domain = existing.customDomain;
  const projectId = process.env.VERCEL_SITES_PROJECT_ID;

  // 1. Detach from Vercel — best-effort (apex + www), same non-fatal pattern
  // as attach's www leg. The Postgres/Sanity cleanup below must happen either way.
  if (projectId) {
    try {
      await vercelDetachDomain(projectId, domain);
    } catch (err) {
      log.warn({ id, domain, err }, 'detachBuildSellDomain: vercel detach (apex) failed (non-fatal)');
    }
    try {
      await vercelDetachDomain(projectId, `www.${domain}`);
    } catch (err) {
      log.warn({ id, domain, err }, 'detachBuildSellDomain: vercel detach (www) failed (non-fatal)');
    }
  } else {
    log.warn({ id, domain }, 'detachBuildSellDomain: VERCEL_SITES_PROJECT_ID not set — skipping Vercel detach');
  }

  // 2. Unset on the Sanity doc synchronously — this is what stops Host-header
  // resolution from serving this site under the old domain.
  try {
    await createWriteClient()
      .patch(buildsellSiteDocId(id))
      .unset(['customDomain'])
      .commit({ visibility: 'sync' });
  } catch (err) {
    log.error({ id, domain, err }, 'detachBuildSellDomain: sanity unset failed');
    return {
      ok: false,
      message: `Sanity update failed — the site may still resolve on ${domain}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 3. Fully null the Postgres row (unique constraint on custom_domain).
  try {
    await db
      .update(buildsellSites)
      .set({ customDomain: null, domainStatus: 'none', domainAttachedAt: null, domainVerifiedAt: null })
      .where(eq(buildsellSites.id, id));
  } catch (err) {
    log.error({ id, domain, err }, 'detachBuildSellDomain: db update failed');
    return {
      ok: false,
      message: `Sanity was cleared, but the database update failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  log.info({ id, domain }, 'detachBuildSellDomain: domain detached');
  revalidatePath('/operator/buildsell');
  revalidatePath(`/operator/buildsell/${id}`);

  return { ok: true };
}

interface VerifyDomainResult {
  ok: boolean;
  message?: string;
  verified?: boolean;
}

/**
 * Force-poll Vercel for the current verification status of this site's
 * custom domain and flip Postgres to 'verified' if confirmed. Only
 * meaningful while domainStatus is 'pending'. Does not touch Sanity —
 * fetchBuildSellSiteByHost keys off customDomain presence, not
 * verified-ness, so there's nothing to re-patch there.
 */
export async function verifyBuildSellDomainNow(formData: FormData): Promise<VerifyDomainResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { ok: false, message: 'Missing site id.' };

  const db = getDb();
  const [existing] = await db
    .select()
    .from(buildsellSites)
    .where(eq(buildsellSites.id, id))
    .limit(1);

  if (!existing) return { ok: false, message: 'Site not found.' };
  if (!existing.customDomain) return { ok: false, message: 'No domain attached.' };
  if (existing.domainStatus === 'verified') return { ok: true, verified: true };

  const projectId = process.env.VERCEL_SITES_PROJECT_ID;
  if (!projectId) {
    return { ok: false, message: 'VERCEL_SITES_PROJECT_ID is not set on this operator deploy.' };
  }

  try {
    const status = await getDomainStatus(projectId, existing.customDomain);
    if (status.verified) {
      await db
        .update(buildsellSites)
        .set({ domainStatus: 'verified', domainVerifiedAt: new Date() })
        .where(eq(buildsellSites.id, id));
      revalidatePath('/operator/buildsell');
      revalidatePath(`/operator/buildsell/${id}`);
      return { ok: true, verified: true };
    }
    return { ok: true, verified: false, message: 'Still pending — check DNS.' };
  } catch (err) {
    log.warn({ id, domain: existing.customDomain, err }, 'verifyBuildSellDomainNow: poll failed');
    return { ok: false, message: err instanceof Error ? err.message : 'Verification poll failed.' };
  }
}

// ─── Image-prompt control ────────────────────────────────────────────────────

export type BuildSellImageKind = 'hero' | 'about' | 'og';

interface ImagePromptResult {
  ok: boolean;
  message?: string;
}

interface RegenImageResult {
  ok: boolean;
  message?: string;
  imageUrl?: string;
}

/**
 * Persist an operator-edited image prompt on the Sanity doc.
 * Writes to `heroImagePrompt`, `aboutImagePrompt`, or `ogImagePrompt`
 * depending on `kind`.
 */
export async function saveBuildSellImagePrompt(
  siteId: string,
  kind: BuildSellImageKind,
  prompt: string,
): Promise<ImagePromptResult> {
  await requireOperatorSession();

  if (!siteId) return { ok: false, message: 'Missing site id.' };
  const trimmed = prompt.trim();
  if (!trimmed) return { ok: false, message: 'Prompt must not be empty.' };
  if (trimmed.length > 2000) return { ok: false, message: 'Prompt too long (max 2000 chars).' };

  const fieldMap: Record<BuildSellImageKind, string> = {
    hero:  'heroImagePrompt',
    about: 'aboutImagePrompt',
    og:    'ogImagePrompt',
  };
  const field = fieldMap[kind];

  try {
    await createWriteClient()
      .patch(buildsellSiteDocId(siteId))
      .set({ [field]: trimmed })
      .commit({ visibility: 'sync' });
    revalidatePath(`/operator/buildsell/${siteId}`);
    revalidatePath('/operator/buildsell');
    log.info({ siteId, kind, field }, 'saveBuildSellImagePrompt: prompt saved');
    return { ok: true };
  } catch (err) {
    log.error({ siteId, kind, err }, 'saveBuildSellImagePrompt failed');
    return { ok: false, message: err instanceof Error ? err.message : 'prompt save failed' };
  }
}

/**
 * Regenerate one image (hero / about / og) for a Build & Sell site.
 *
 * Cap enforcement (R15): a durable per-site daily counter is stored inside
 * `buildsell_sites.metadata` (no new columns, no migration). The counter
 * object lives at `metadata.regenCap` and has shape:
 *
 *   { date: "YYYY-MM-DD", count: number }
 *
 * The date is today in UTC. On each call we:
 *   1. Read the current metadata row from Postgres (read-before-spend).
 *   2. If the date has rolled over, reset count = 0.
 *   3. If count >= cap (BUILDSELL_REGEN_CAP_PER_DAY, default 5), refuse.
 *   4. Otherwise proceed with image generation, then increment the counter
 *      in metadata (no dedicated column — stored in existing jsonb).
 *
 * Per-kind Imagen aspect ratios: hero=16:9 / about=4:3 / og=1:1.
 * Sanity patch targets: hero -> sections[_key=="hero"].image,
 *                       about -> sections[_key=="about"].image,
 *                       og -> seo.ogImage.
 */
export async function regenerateBuildSellImage(
  siteId: string,
  kind: BuildSellImageKind,
): Promise<RegenImageResult> {
  await requireOperatorSession();

  if (!siteId) return { ok: false, message: 'Missing site id.' };

  const db = getDb();

  // 1. Read-before-spend: fetch the Postgres row for cap check.
  const [row] = await db
    .select({ metadata: buildsellSites.metadata })
    .from(buildsellSites)
    .where(eq(buildsellSites.id, siteId))
    .limit(1);

  if (!row) return { ok: false, message: 'Site not found.' };

  const capPerDay = Number(process.env.BUILDSELL_REGEN_CAP_PER_DAY ?? '5');
  const todayUtc  = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const meta    = (row.metadata ?? {}) as Record<string, unknown>;
  const capData = (meta.regenCap ?? {}) as { date?: string; count?: number };
  const prevDate  = capData.date  ?? '';
  const prevCount = capData.count ?? 0;
  const todayCount = prevDate === todayUtc ? prevCount : 0;

  if (todayCount >= capPerDay) {
    log.warn({ siteId, kind, todayCount, capPerDay }, 'regenerateBuildSellImage: daily cap reached — spending $0');
    return {
      ok: false,
      message: `Daily regeneration cap (${capPerDay}/day) reached for this site. Try again tomorrow.`,
    };
  }

  // 2. Fetch the prompt from Sanity.
  const client = createWriteClient();
  const promptFieldMap: Record<BuildSellImageKind, string> = {
    hero:  'heroImagePrompt',
    about: 'aboutImagePrompt',
    og:    'ogImagePrompt',
  };
  const promptField = promptFieldMap[kind];

  const promptDoc = await client.fetch<Record<string, string | null>>(
    `*[_id==$id][0]{ ${promptField} }`,
    { id: buildsellSiteDocId(siteId) },
  );
  const prompt = promptDoc?.[promptField];
  if (!prompt) {
    return { ok: false, message: `No ${promptField} on site doc — save a prompt first.` };
  }

  // 3. Generate image.
  const aspectMap: Record<BuildSellImageKind, '16:9' | '4:3' | '1:1'> = {
    hero:  '16:9',
    about: '4:3',
    og:    '1:1',
  };
  const aspect = aspectMap[kind];

  let imageUrl: string;
  try {
    const img = await generateHeroImageBuffer(prompt, { aspectRatio: aspect });
    if (!img) {
      return { ok: false, message: 'No image provider configured (set GOOGLE_API_KEY or AI_GATEWAY_API_KEY).' };
    }

    // 4. Upload to Sanity assets.
    const uploaded = await uploadHeroImage(`bs-${siteId}-${kind}`, img.buffer);

    // 5. Patch the Sanity doc.
    const imageRef = { _type: 'image', asset: { _type: 'reference', _ref: uploaded.assetId } };
    if (kind === 'hero') {
      await client
        .patch(buildsellSiteDocId(siteId))
        .set({ 'sections[_key=="hero"].image': imageRef })
        .commit({ visibility: 'sync' });

      // Trust layout renders a 3-tile hero strip. One "Regenerate hero" fills
      // all three: tiles 2 & 3 are variations of the same prompt. Best-effort —
      // a failed variation just leaves a gradient tile, never blocks tile 1.
      const layoutDoc = await client.fetch<{ layout?: string | null }>(
        `*[_id==$id][0]{ "layout": theme.layoutVariant }`,
        { id: buildsellSiteDocId(siteId) },
      );
      if (layoutDoc?.layout === 'trust') {
        const strip: Array<['imageB' | 'imageC', string]> = [
          ['imageB', `${prompt}. Alternate angle, different composition.`],
          ['imageC', `${prompt}. Close-up detail shot.`],
        ];
        for (const [field, variantPrompt] of strip) {
          try {
            const variant = await generateHeroImageBuffer(variantPrompt, { aspectRatio: '4:3' });
            if (!variant) continue;
            const up = await uploadHeroImage(`bs-${siteId}-${field}`, variant.buffer);
            await client
              .patch(buildsellSiteDocId(siteId))
              .set({ [`sections[_key=="hero"].${field}`]: { _type: 'image', asset: { _type: 'reference', _ref: up.assetId } } })
              .commit({ visibility: 'sync' });
          } catch (err) {
            log.warn({ siteId, field, err }, 'regenerateBuildSellImage: trust strip tile failed (non-fatal)');
          }
        }
      }
    } else if (kind === 'about') {
      await client
        .patch(buildsellSiteDocId(siteId))
        .set({ 'sections[_key=="about"].image': imageRef })
        .commit({ visibility: 'sync' });
    } else {
      // og
      await client
        .patch(buildsellSiteDocId(siteId))
        .set({ 'seo.ogImage': imageRef })
        .commit({ visibility: 'sync' });
    }

    imageUrl = uploaded.url;
    log.info({ siteId, kind, imageUrl }, 'regenerateBuildSellImage: image uploaded + doc patched');
  } catch (err) {
    log.error({ siteId, kind, err }, 'regenerateBuildSellImage: generation/upload failed');
    return { ok: false, message: err instanceof Error ? err.message : 'image regen failed' };
  }

  // 6. Increment durable counter (metadata jsonb — no new column).
  try {
    const newMeta = {
      ...meta,
      regenCap: { date: todayUtc, count: todayCount + 1 },
    };
    await db
      .update(buildsellSites)
      .set({ metadata: newMeta })
      .where(eq(buildsellSites.id, siteId));
  } catch (err) {
    // Non-fatal: the image was already generated. Cap may over-run by 1 in a
    // concurrent race, but that's acceptable versus blocking on a counter write.
    log.warn({ siteId, err }, 'regenerateBuildSellImage: counter update failed (non-fatal)');
  }

  revalidatePath(`/operator/buildsell/${siteId}`);
  revalidatePath('/operator/buildsell');
  return { ok: true, imageUrl };
}

/**
 * Regenerate the favicon as an initials monogram on the site's preset primary
 * color. No Imagen spend (it's a generated SVG), so it's exempt from the daily
 * image cap. Reads businessName + theme.preset from the Sanity doc.
 */
export async function regenerateBuildSellFavicon(siteId: string): Promise<RegenImageResult> {
  await requireOperatorSession();
  if (!siteId) return { ok: false, message: 'Missing site id.' };

  const client = createWriteClient();
  const doc = await client.fetch<{ businessName?: string | null; preset?: string | null }>(
    `*[_id==$id][0]{ businessName, "preset": theme.preset }`,
    { id: buildsellSiteDocId(siteId) },
  );
  if (!doc?.businessName) return { ok: false, message: 'Site has no business name — build the draft first.' };

  try {
    const preset = presetByName(doc.preset);
    const fav = await generateAndUploadFavicon(siteId, doc.businessName, {
      bgHex: preset?.primary ?? '#0f172a',
      fgHex: preset?.onPrimary ?? '#ffffff',
    });
    await client
      .patch(buildsellSiteDocId(siteId))
      .set({ favicon: { _type: 'image', asset: { _type: 'reference', _ref: fav.assetId } } })
      .commit({ visibility: 'sync' });
    revalidatePath(`/operator/buildsell/${siteId}`);
    revalidatePath('/operator/buildsell');
    log.info({ siteId }, 'regenerateBuildSellFavicon: favicon regenerated');
    return { ok: true, imageUrl: fav.url };
  } catch (err) {
    log.error({ siteId, err }, 'regenerateBuildSellFavicon failed');
    return { ok: false, message: err instanceof Error ? err.message : 'favicon regen failed' };
  }
}

// ─── Content migration (crawl existing site → review queue → apply) ───────────

interface CrawlResult {
  ok: boolean;
  message?: string;
}

/**
 * Enqueue a content-migrator run for a draft site. Resolves the prospect's
 * website from the fresh Places cache (by place_id) and dispatches a
 * `buildsell.migrate` event. The agent stages suggestions on
 * metadata.pendingMigration — it never touches the live Sanity doc.
 *
 * Disabled at the UI level when no website is on file; this re-checks server-side.
 */
export async function crawlExistingSite(siteId: string): Promise<CrawlResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  if (!siteId) return { ok: false, message: 'Missing site id.' };

  const db = getDb();
  const [site] = await db
    .select()
    .from(buildsellSites)
    .where(eq(buildsellSites.id, siteId))
    .limit(1);
  if (!site) return { ok: false, message: 'Site not found.' };
  if (site.status === 'paid' || site.status === 'live') {
    return { ok: false, message: `Cannot crawl a ${site.status} site.` };
  }

  // Resolve the website URI from the fresh Places cache (by place_id). It is
  // never stored on buildsell_sites; the reaper may have nulled it after 30d.
  let websiteUri: string | null = null;
  if (site.placeId) {
    try {
      const cached = await fetchFreshBuildsellLeads([site.placeId]);
      websiteUri = cached[0]?.websiteUri ?? null;
    } catch (err) {
      log.warn({ siteId, err }, 'crawlExistingSite: cache lookup failed');
    }
  }
  if (!websiteUri) {
    return { ok: false, message: 'No website on file for this lead (not cached, or the lead has no site).' };
  }

  try {
    await db.insert(agentEvents).values({
      agent: 'operator',
      type: 'buildsell.migrate',
      targetAgent: 'content-migrator',
      payload: {
        buildsell_site_id: siteId,
        website_uri: websiteUri,
        crawl_epoch: Date.now().toString(),
      },
    });
  } catch (err) {
    log.error({ siteId, err }, 'crawlExistingSite: event insert failed');
    return { ok: false, message: `Failed to enqueue crawl: ${err instanceof Error ? err.message : String(err)}` };
  }

  log.info({ siteId, websiteUri }, 'crawlExistingSite: migration crawl enqueued');
  revalidatePath(`/operator/buildsell/${siteId}`);
  return { ok: true, message: 'Crawl queued. Suggestions appear here once it finishes (~1 min).' };
}

interface ApplyMigrationResult {
  ok: boolean;
  message?: string;
}

function imageRef(assetId: string) {
  return { _type: 'image', asset: { _type: 'reference', _ref: assetId } };
}

/**
 * Apply operator-approved migration selections to the live Sanity doc AND
 * record them in the durable `migrated` overlay (so a future rebuild re-applies
 * them via the read-merge in persist-sanity.ts). Clears the pending blob.
 *
 * Patches the visible doc immediately (no rebuild needed for preview): the
 * sections array is mutated in place — hero headline/image, about body/image,
 * services, footer socials — plus a bsUgcSection is inserted before the footer.
 */
export async function applyMigrationSelections(
  siteId: string,
  selections: MigrationSelections,
): Promise<ApplyMigrationResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  if (!siteId) return { ok: false, message: 'Missing site id.' };

  const db = getDb();
  const [site] = await db
    .select({ metadata: buildsellSites.metadata })
    .from(buildsellSites)
    .where(eq(buildsellSites.id, siteId))
    .limit(1);
  if (!site) return { ok: false, message: 'Site not found.' };

  const meta = (site.metadata ?? {}) as Record<string, unknown>;
  const pending = (meta[PENDING_MIGRATION_KEY] ?? {}) as { source?: string };
  const source = typeof pending.source === 'string' ? pending.source : undefined;

  const client = createWriteClient();
  const docId = buildsellSiteDocId(siteId);

  // Fetch the current doc so we can mutate its sections array in place.
  const doc = (await client.getDocument(docId)) as Record<string, unknown> | null | undefined;
  if (!doc) {
    return { ok: false, message: 'Site has not been built yet — build the draft before applying migration.' };
  }
  const sections = Array.isArray(doc['sections'])
    ? (doc['sections'] as Array<Record<string, unknown>>).map((s) => ({ ...s }))
    : [];

  const find = (type: string) => sections.find((s) => s['_type'] === type);

  // Hero: headline (drop highlight — fragment no longer matches) + image.
  if (selections.headline || selections.heroImage) {
    const hero = find('bsHeroSection');
    if (hero) {
      if (selections.headline) {
        hero['headline'] = selections.headline;
        delete hero['highlight'];
      }
      if (selections.heroImage) hero['image'] = imageRef(selections.heroImage.assetId);
    }
  }

  // About: body + image.
  if (selections.aboutBody || selections.aboutImage) {
    const about = find('bsAboutSection');
    if (about) {
      if (selections.aboutBody) about['body'] = selections.aboutBody;
      if (selections.aboutImage) about['image'] = imageRef(selections.aboutImage.assetId);
    }
  }

  // Services.
  if (selections.services && selections.services.length > 0) {
    const svc = find('bsServicesSection');
    if (svc) {
      svc['services'] = selections.services.map((s, i) => ({
        _key: `svc${i}`,
        _type: 'bsServiceCard',
        icon: s.icon,
        title: s.title,
        description: s.description,
      }));
    }
  }

  // Footer socials.
  if (selections.socials && selections.socials.length > 0) {
    const footer = find('bsFooterSection');
    if (footer) {
      footer['social'] = selections.socials.map((s, i) => ({
        _key: `soc${i}`,
        _type: 'bsSocialLink',
        platform: s.platform,
        href: s.href,
      }));
    }
  }

  // UGC: rebuild a bsUgcSection and place it before the footer (or append).
  if (selections.ugc && selections.ugc.length > 0) {
    const ugcSection = {
      _key: 'ugc',
      _type: 'bsUgcSection',
      heading: 'From Our Community',
      items: selections.ugc.map((u, i) => ({
        _key: `ugc${i}`,
        _type: 'bsUgcItem',
        platform: u.platform,
        ...(u.postUrl ? { postUrl: u.postUrl } : {}),
        ...(u.caption ? { caption: u.caption } : {}),
        order: i,
        ...(u.asset ? { thumbnail: imageRef(u.asset.assetId) } : {}),
      })),
    };
    const withoutUgc = sections.filter((s) => s['_type'] !== 'bsUgcSection');
    const footerIdx = withoutUgc.findIndex((s) => s['_type'] === 'bsFooterSection');
    if (footerIdx >= 0) withoutUgc.splice(footerIdx, 0, ugcSection);
    else withoutUgc.push(ugcSection);
    sections.length = 0;
    sections.push(...withoutUgc);
  }

  // Durable overlay (bsMigrated) — re-applied on every rebuild.
  const migrated: Record<string, unknown> = { _type: 'bsMigrated', migratedAt: new Date().toISOString() };
  if (source) migrated.source = source;
  if (selections.headline) migrated.headline = selections.headline;
  if (selections.aboutBody) migrated.aboutBody = selections.aboutBody;
  if (selections.services?.length) {
    migrated.services = selections.services.map((s, i) => ({ _key: `msvc${i}`, _type: 'bsServiceCard', icon: s.icon, title: s.title, description: s.description }));
  }
  if (selections.socials?.length) {
    migrated.socials = selections.socials.map((s, i) => ({ _key: `msoc${i}`, _type: 'bsSocialLink', platform: s.platform, href: s.href }));
  }
  if (selections.logo) migrated.logoAssetId = selections.logo.assetId;
  if (selections.heroImage) migrated.heroImageAssetId = selections.heroImage.assetId;
  if (selections.aboutImage) migrated.aboutImageAssetId = selections.aboutImage.assetId;
  if (selections.ugc?.length) {
    migrated.ugc = selections.ugc.map((u, i) => ({
      _key: `mugc${i}`,
      _type: 'bsMigratedUgcItem',
      platform: u.platform,
      ...(u.postUrl ? { postUrl: u.postUrl } : {}),
      ...(u.caption ? { caption: u.caption } : {}),
      ...(u.asset ? { thumbnailAssetId: u.asset.assetId } : {}),
    }));
  }

  const patchSet: Record<string, unknown> = { sections, migrated };
  if (selections.logo) patchSet.logo = imageRef(selections.logo.assetId);

  try {
    await client.patch(docId).set(patchSet).commit({ visibility: 'sync' });
  } catch (err) {
    log.error({ siteId, err }, 'applyMigrationSelections: Sanity patch failed');
    return { ok: false, message: `Apply failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Mark the pending blob applied (clears it from the review queue).
  try {
    const newMeta = { ...meta, [PENDING_MIGRATION_KEY]: { ...(meta[PENDING_MIGRATION_KEY] as object ?? {}), status: 'applied' } };
    await db.update(buildsellSites).set({ metadata: newMeta }).where(eq(buildsellSites.id, siteId));
  } catch (err) {
    log.warn({ siteId, err }, 'applyMigrationSelections: pending status update failed (non-fatal)');
  }

  log.info({ siteId }, 'applyMigrationSelections: migration applied to live doc + overlay');
  revalidatePath(`/operator/buildsell/${siteId}`);
  revalidatePath('/operator/buildsell');
  return { ok: true, message: 'Migration applied. Preview to review.' };
}

/** Discard the pending migration suggestions without applying anything. */
export async function rejectMigration(siteId: string): Promise<ApplyMigrationResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  if (!siteId) return { ok: false, message: 'Missing site id.' };

  const db = getDb();
  const [site] = await db
    .select({ metadata: buildsellSites.metadata })
    .from(buildsellSites)
    .where(eq(buildsellSites.id, siteId))
    .limit(1);
  if (!site) return { ok: false, message: 'Site not found.' };

  const meta = (site.metadata ?? {}) as Record<string, unknown>;
  const newMeta = { ...meta, [PENDING_MIGRATION_KEY]: { ...(meta[PENDING_MIGRATION_KEY] as object ?? {}), status: 'rejected' } };
  try {
    await db.update(buildsellSites).set({ metadata: newMeta }).where(eq(buildsellSites.id, siteId));
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'reject failed' };
  }
  revalidatePath(`/operator/buildsell/${siteId}`);
  return { ok: true, message: 'Suggestions discarded.' };
}

// ─── Regenerate all content for an existing site ─────────────────────────────

interface RegenerateSiteResult {
  ok: boolean;
  message?: string;
}

/**
 * Trigger a full rebuild of an existing Build & Sell site (copy + optional
 * theme rotation). Enqueues a `buildsell.build` event for spec-site-builder.
 *
 * - Blocked on paid/live sites (clobber protection; consistent with
 *   reviseBuildSellCopy and the existing banner on the detail page).
 * - Per-site daily cap in `metadata.rebuildCap` (separate lane from
 *   regenCap/reviseCap), read-before-spend — mirrors reviseBuildSellCopy.
 *   Default cap: BUILDSELL_REBUILD_CAP_PER_DAY env (default 3, intentionally
 *   low — full rebuilds are the most expensive Imagen spend lane).
 * - rotateTheme:true => full regen (preserve_theme OMITTED), theme re-rolled.
 * - rotateTheme:false => copy only, same design (preserve_theme:true).
 * - Stamps a fresh buildEpoch so the agent's dedupe key (bs:{id}:{epoch})
 *   is distinct from the prior build.
 */
export async function regenerateBuildSellSite(
  siteId: string,
  { rotateTheme = true }: { rotateTheme?: boolean } = {},
): Promise<RegenerateSiteResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  if (!siteId) return { ok: false, message: 'Missing site id.' };

  const db = getDb();

  // Read-before-spend: status guard + cap check off the Postgres row.
  const [row] = await db
    .select({ status: buildsellSites.status, metadata: buildsellSites.metadata })
    .from(buildsellSites)
    .where(eq(buildsellSites.id, siteId))
    .limit(1);

  if (!row) return { ok: false, message: 'Site not found.' };

  if (row.status === 'paid' || row.status === 'live') {
    return {
      ok: false,
      message: `Cannot regenerate a ${row.status} site — it is sold and indexed. The clobber-protection banner explains why.`,
    };
  }

  const capPerDay   = Number(process.env.BUILDSELL_REBUILD_CAP_PER_DAY ?? '3');
  const todayUtc    = new Date().toISOString().slice(0, 10);
  const meta        = (row.metadata ?? {}) as Record<string, unknown>;
  const capData     = (meta.rebuildCap ?? {}) as { date?: string; count?: number };
  const todayCount  = capData.date === todayUtc ? (capData.count ?? 0) : 0;

  if (todayCount >= capPerDay) {
    log.warn({ siteId, todayCount, capPerDay }, 'regenerateBuildSellSite: daily cap reached');
    return {
      ok: false,
      message: `Daily rebuild cap (${capPerDay}/day) reached for this site. Try again tomorrow.`,
    };
  }

  const buildEpoch = Date.now().toString();

  // Stamp fresh epoch + increment cap BEFORE enqueue (audit trail + dedupe).
  try {
    await db
      .update(buildsellSites)
      .set({
        buildEpoch,
        metadata: {
          ...meta,
          rebuildCap: { date: todayUtc, count: todayCount + 1 },
        },
        updatedAt: new Date(),
      })
      .where(eq(buildsellSites.id, siteId));
  } catch (err) {
    log.error({ siteId, err }, 'regenerateBuildSellSite: row update failed');
    return { ok: false, message: err instanceof Error ? err.message : 'failed to stamp rebuild epoch' };
  }

  // Payload: omit preserve_theme for a full regen (theme re-rolls);
  // set preserve_theme:true when the operator wants copy-only on the same design.
  const eventPayload: Record<string, unknown> = {
    buildsell_site_id: siteId,
    build_epoch: buildEpoch,
  };
  if (!rotateTheme) {
    eventPayload.preserve_theme = true;
  }

  try {
    await db.insert(agentEvents).values({
      agent: 'operator',
      type: 'buildsell.build',
      targetAgent: 'spec-site-builder',
      payload: eventPayload,
    });
  } catch (err) {
    log.error({ siteId, err }, 'regenerateBuildSellSite: agent event insert failed');
    return {
      ok: false,
      message: `Epoch stamped but build event failed to enqueue: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  log.info({ siteId, rotateTheme, buildEpoch }, 'regenerateBuildSellSite: rebuild event enqueued');

  // Drain immediately so spec-site-builder starts now (same pattern as buildDraft).
  try {
    const { runOperatorTick } = await import('@/lib/operator-tick');
    await runOperatorTick();
  } catch (err) {
    log.warn(
      { siteId, err: err instanceof Error ? err.message : err },
      'regenerateBuildSellSite: inline operator-tick failed — cron will pick up the event',
    );
  }

  revalidatePath(`/operator/buildsell/${siteId}`);
  revalidatePath('/operator/buildsell');
  return { ok: true };
}

// ─── Revise copy ───────────────────────────────────────────────────────────

/**
 * Regenerate a Build & Sell site's COPY with an operator clarifying prompt,
 * keeping the existing design (preserve_theme). Use when the generated copy
 * misreads the business (e.g. an auto PAINT STORE written up as a body shop).
 *
 * - Blocked on paid/live sites (re-indexing a sold site); the spec-site-builder
 *   RebuildProtectedError is the backstop. Invoiced sites are allowed and the
 *   builder keeps them 'invoiced'.
 * - Durable daily cap in `metadata.reviseCap` (separate lane from regenCap),
 *   read-before-spend — mirrors regenerateBuildSellImage. Default 5/day.
 * - Stamps a fresh build_epoch so the dedupe key differs from the prior build,
 *   and records the prompt at `metadata.lastClarifyingPrompt`.
 */
export async function reviseBuildSellCopy(
  siteId: string,
  clarifyingPrompt: string,
): Promise<{ ok: boolean; message?: string }> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  if (!siteId) return { ok: false, message: 'Missing site id.' };
  const prompt = (clarifyingPrompt ?? '').trim();
  if (!prompt) return { ok: false, message: 'Enter a clarification describing the business.' };
  if (prompt.length > 500) return { ok: false, message: 'Clarification must be 500 characters or fewer.' };

  const db = getDb();

  // Read-before-spend: status guard + cap check off the Postgres row.
  const [row] = await db
    .select({ status: buildsellSites.status, metadata: buildsellSites.metadata })
    .from(buildsellSites)
    .where(eq(buildsellSites.id, siteId))
    .limit(1);
  if (!row) return { ok: false, message: 'Site not found.' };

  if (row.status === 'paid' || row.status === 'live') {
    return { ok: false, message: `Cannot revise a ${row.status} site — it is sold and indexed.` };
  }

  const capPerDay = Number(process.env.BUILDSELL_REVISE_CAP_PER_DAY ?? '5');
  const todayUtc  = new Date().toISOString().slice(0, 10);
  const meta      = (row.metadata ?? {}) as Record<string, unknown>;
  const capData   = (meta.reviseCap ?? {}) as { date?: string; count?: number };
  const todayCount = (capData.date === todayUtc ? (capData.count ?? 0) : 0);

  if (todayCount >= capPerDay) {
    log.warn({ siteId, todayCount, capPerDay }, 'reviseBuildSellCopy: daily cap reached');
    return { ok: false, message: `Daily revision cap (${capPerDay}/day) reached for this site. Try again tomorrow.` };
  }

  const buildEpoch = Date.now().toString();

  // Persist cap + last prompt + fresh epoch BEFORE enqueue (audit trail + dedupe).
  try {
    await db
      .update(buildsellSites)
      .set({
        buildEpoch,
        metadata: {
          ...meta,
          reviseCap: { date: todayUtc, count: todayCount + 1 },
          lastClarifyingPrompt: { prompt, revisedAt: new Date().toISOString() },
        },
        updatedAt: new Date(),
      })
      .where(eq(buildsellSites.id, siteId));
  } catch (err) {
    log.error({ siteId, err }, 'reviseBuildSellCopy: row update failed');
    return { ok: false, message: err instanceof Error ? err.message : 'failed to record revision' };
  }

  try {
    await db.insert(agentEvents).values({
      agent: 'operator',
      type: 'buildsell.revise',
      targetAgent: 'spec-site-builder',
      payload: {
        buildsell_site_id: siteId,
        build_epoch: buildEpoch,
        clarifying_prompt: prompt,
        preserve_theme: true,
      },
    });
  } catch (err) {
    log.error({ siteId, err }, 'reviseBuildSellCopy: agent event insert failed');
    return { ok: false, message: `Revision recorded but failed to enqueue: ${err instanceof Error ? err.message : String(err)}` };
  }

  log.info({ siteId, len: prompt.length }, 'reviseBuildSellCopy: revise event enqueued');
  revalidatePath(`/operator/buildsell/${siteId}`);
  revalidatePath('/operator/buildsell');
  return { ok: true };
}

// NOTE: do NOT re-export types from this 'use server' file. Turbopack's
// server-action transform registers every export as a server reference; an
// `export type { ... }` of an erased identifier becomes `registerServer
// reference(undefined-identifier)` and throws "X is not defined" at module
// eval. Client components import these types from their real source modules.
