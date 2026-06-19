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
import { searchLeads } from '@leadlandlord/integrations/google-places';
import { sendEmail } from '@leadlandlord/integrations/resend';
import { createWriteClient, uploadHeroImage } from '@leadlandlord/integrations/sanity';
import { generateHeroImageBuffer } from '@leadlandlord/integrations/imagen';
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
 * Mark a site as paid + live. Patches the Sanity doc to clear draftMode and
 * robotsDisallow so the public site becomes crawlable.
 *
 * Guard: only proceeds when status is 'invoiced' or 'paid' (idempotent re-run).
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

  // Patch the SEO-critical Sanity flags FIRST. The Sanity network call is the
  // less-reliable write; if it fails we leave the row at 'invoiced' so the
  // operator can retry — never a 'live' DB row pointing at a still-watermarked,
  // noindexed Sanity doc.
  const docId = buildsellSiteDocId(id);
  try {
    await createWriteClient()
      .patch(docId)
      .set({ draftMode: false, robotsDisallow: false })
      .commit({ visibility: 'sync' });
  } catch (err) {
    log.error({ id, docId, err }, 'markPaid: Sanity patch failed — leaving status unchanged');
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

  log.info({ id, slug: existing.slug }, 'markPaid: site marked live');
  revalidatePath('/operator/buildsell');

  return {
    ok: true,
    message: `Site is now live${existing.slug ? ` at /buildsell/${existing.slug}` : ''}.`,
    slug: existing.slug,
  };
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
