'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, buildsellSites } from '@leadlandlord/db';
import { createWriteClient } from '@leadlandlord/integrations/sanity';
import { buildsellSiteDocId } from '@leadlandlord/sanity-schema/ids';
import { ensureKlaviyoListForBuildSell } from '@leadlandlord/agents/spec-site-builder/klaviyo';
import { requireOperatorSession } from '@/lib/auth';
import { log } from '@leadlandlord/shared/log';

export interface LeadForwardingActionResult {
  ok: boolean;
  message?: string;
  klaviyoListId?: string | null;
}

/**
 * Updates the lead-forwarding owner email for a Build & Sell site.
 *
 * Postgres (buildsell_sites.owner_email) is the value /api/bs/lead reads —
 * it's the source of truth. The Sanity mirror field is patched best-effort
 * afterward so it's visible in Studio; a Sanity failure never blocks the
 * Postgres write (same non-fatal pattern as sendInvoice's purchaseUrl patch).
 */
export async function updateOwnerEmail(formData: FormData): Promise<LeadForwardingActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const siteId = String(formData.get('site_id') ?? '').trim();
  const rawEmail = String(formData.get('owner_email') ?? '').trim();
  const ownerEmail = rawEmail || null;

  if (!siteId) return { ok: false, message: 'Missing site id.' };
  if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    return { ok: false, message: 'Enter a valid email address.' };
  }

  const db = getDb();
  const [existing] = await db
    .select({ id: buildsellSites.id })
    .from(buildsellSites)
    .where(eq(buildsellSites.id, siteId))
    .limit(1);
  if (!existing) return { ok: false, message: 'Site not found.' };

  await db.update(buildsellSites).set({ ownerEmail }).where(eq(buildsellSites.id, siteId));

  const docId = buildsellSiteDocId(siteId);
  try {
    await createWriteClient()
      .patch(docId)
      .set({ ownerEmail: ownerEmail ?? undefined })
      .commit({ visibility: 'async' });
  } catch (err) {
    log.warn({ siteId, docId, err }, 'updateOwnerEmail: Sanity mirror patch failed (non-fatal)');
  }

  revalidatePath(`/operator/buildsell/${siteId}`);
  return { ok: true, message: ownerEmail ? `Leads will forward to ${ownerEmail}.` : 'Owner email cleared.' };
}

/**
 * Manually (re)provisions the Klaviyo list for a site. Idempotent — safe to
 * click repeatedly. Recovery path for when the build-time creation in
 * spec-site-builder was skipped (no API key at build time) or failed.
 */
export async function retryKlaviyoList(siteId: string): Promise<LeadForwardingActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }
  if (!siteId) return { ok: false, message: 'Missing site id.' };

  const db = getDb();
  const [site] = await db
    .select({ businessName: buildsellSites.businessName, city: buildsellSites.city, state: buildsellSites.state })
    .from(buildsellSites)
    .where(eq(buildsellSites.id, siteId))
    .limit(1);
  if (!site) return { ok: false, message: 'Site not found.' };

  const listId = await ensureKlaviyoListForBuildSell(siteId, site.businessName, site.city, site.state, log);
  if (!listId) {
    return { ok: false, message: 'Klaviyo list creation failed or KLAVIYO_PRIVATE_API_KEY is not set.' };
  }

  const docId = buildsellSiteDocId(siteId);
  try {
    await createWriteClient().patch(docId).set({ klaviyoListId: listId }).commit({ visibility: 'async' });
  } catch (err) {
    log.warn({ siteId, docId, err }, 'retryKlaviyoList: Sanity mirror patch failed (non-fatal)');
  }

  revalidatePath(`/operator/buildsell/${siteId}`);
  return { ok: true, message: `Klaviyo list ready: ${listId}`, klaviyoListId: listId };
}
