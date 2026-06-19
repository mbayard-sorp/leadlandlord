'use server';

import { revalidatePath } from 'next/cache';
import { eq, isNotNull, sql } from 'drizzle-orm';
import { getDb, buildsellSites, agentEvents } from '@leadlandlord/db';
import type { BuildsellSite } from '@leadlandlord/db';
import { searchLeads, type BuildSellLeadResult } from '@leadlandlord/integrations/google-places';
import { sendEmail } from '@leadlandlord/integrations/resend';
import { createWriteClient } from '@leadlandlord/integrations/sanity';
import { buildsellSiteDocId } from '@leadlandlord/sanity-schema/ids';
import { buildInvoicePdf } from '@/lib/buildsell-invoice';
import { requireOperatorSession } from '@/lib/auth';
import { log } from '@leadlandlord/shared/log';

// ─── Search ──────────────────────────────────────────────────────────────────

interface SearchResult {
  ok: boolean;
  leads?: BuildSellLeadResult[];
  message?: string;
}

/**
 * Ephemeral Places search. Returns transient results only — do NOT query
 * buildsell_leads to render these (ToS: ephemeral UI only).
 * searchLeads itself handles the 30-day cache upsert.
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
    const leads = await searchLeads({ trade, city, state, count });
    return { ok: true, leads };
  } catch (err) {
    log.error({ trade, city, state, err }, 'runBuildSellSearch failed');
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

  if (!businessName) return { ok: false, message: 'Business name is required.' };
  if (!trade)        return { ok: false, message: 'Trade is required.' };
  if (!city)         return { ok: false, message: 'City is required.' };
  if (state.length !== 2) return { ok: false, message: 'State must be a two-letter code.' };

  // Carry forward Places signal fields into metadata (jsonb) so the agent
  // can use them for prompt enrichment. These survive the reaper in metadata.
  const rating         = ratingRaw       ? parseFloat(ratingRaw)       : null;
  const userRatingCount = ratingCountRaw ? parseInt(ratingCountRaw, 10) : null;
  const metadata: Record<string, unknown> = {};
  if (rating != null && !isNaN(rating))              metadata.rating          = rating;
  if (userRatingCount != null && !isNaN(userRatingCount)) metadata.userRatingCount = userRatingCount;
  if (primaryType)                                   metadata.primaryType     = primaryType;

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

  try {
    await db.insert(agentEvents).values({
      agent: 'operator',
      type: 'buildsell.build',
      targetAgent: 'spec-site-builder',
      payload: { buildsell_site_id: row.id, build_epoch: buildEpoch },
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
// NOTE: do NOT re-export types from this 'use server' file. Turbopack's
// server-action transform registers every export as a server reference; an
// `export type { ... }` of an erased identifier becomes `registerServer
// reference(undefined-identifier)` and throws "X is not defined" at module
// eval. Client components import these types from their real source modules.
