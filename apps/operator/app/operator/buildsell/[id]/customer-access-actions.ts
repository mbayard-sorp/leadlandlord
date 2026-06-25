'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb, bsCustomerSiteAccess, buildsellSites } from '@leadlandlord/db';
import { requireOperatorSession } from '@/lib/auth';
import { log } from '@leadlandlord/shared/log';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AccessRow {
  id: string;
  authUserId: string;
  buildsellSiteId: string;
  grantedBy: string;
  grantedAt: string;
  revokedAt: string | null;
}

export interface AccessActionResult {
  ok: boolean;
  message?: string;
}

// ─── List access rows for a site ─────────────────────────────────────────────

export async function listSiteAccess(siteId: string): Promise<AccessRow[]> {
  await requireOperatorSession();
  const db = getDb();
  const rows = await db
    .select()
    .from(bsCustomerSiteAccess)
    .where(eq(bsCustomerSiteAccess.buildsellSiteId, siteId));
  return rows.map((r) => ({
    id: r.id,
    authUserId: r.authUserId,
    buildsellSiteId: r.buildsellSiteId,
    grantedBy: r.grantedBy,
    grantedAt: r.grantedAt.toISOString(),
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
  }));
}

// ─── Grant access ────────────────────────────────────────────────────────────

/**
 * Resolve or create a Neon Auth user for ownerEmail and insert an active
 * bs_customer_site_access row (granted_by: 'operator').
 *
 * Wraps provisionCustomerAccess from the integrations package.
 */
export async function grantAccess(formData: FormData): Promise<AccessActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const siteId = String(formData.get('site_id') ?? '').trim();
  const email  = String(formData.get('email')   ?? '').trim().toLowerCase();

  if (!siteId) return { ok: false, message: 'Missing site id.' };
  if (!email)  return { ok: false, message: 'Email is required.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'Enter a valid email address.' };
  }

  const db = getDb();
  const [site] = await db
    .select({ businessName: buildsellSites.businessName })
    .from(buildsellSites)
    .where(eq(buildsellSites.id, siteId))
    .limit(1);

  if (!site) return { ok: false, message: 'Site not found.' };

  try {
    const { provisionCustomerAccess } = await import('@leadlandlord/integrations/neon-auth');
    const authUserId = await provisionCustomerAccess({
      ownerEmail: email,
      businessName: site.businessName,
      siteId,
      grantedBy: 'operator',
    });
    log.info({ siteId, email, authUserId }, 'grantAccess: access provisioned');
    revalidatePath(`/operator/buildsell/${siteId}`);
    return { ok: true, message: `Access granted to ${email}.` };
  } catch (err) {
    log.error({ siteId, email, err }, 'grantAccess: provisioning failed');
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Revoke access ────────────────────────────────────────────────────────────

/**
 * Soft-revoke an access row by setting revoked_at = now().
 */
export async function revokeAccess(formData: FormData): Promise<AccessActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const accessRowId = String(formData.get('access_row_id') ?? '').trim();
  const siteId      = String(formData.get('site_id')       ?? '').trim();

  if (!accessRowId) return { ok: false, message: 'Missing access row id.' };

  const db = getDb();
  const [existing] = await db
    .select({ id: bsCustomerSiteAccess.id, revokedAt: bsCustomerSiteAccess.revokedAt })
    .from(bsCustomerSiteAccess)
    .where(
      and(
        eq(bsCustomerSiteAccess.id, accessRowId),
        isNull(bsCustomerSiteAccess.revokedAt),
      ),
    )
    .limit(1);

  if (!existing) {
    return { ok: false, message: 'Access row not found or already revoked.' };
  }

  await db
    .update(bsCustomerSiteAccess)
    .set({ revokedAt: new Date() })
    .where(eq(bsCustomerSiteAccess.id, accessRowId));

  log.info({ accessRowId }, 'revokeAccess: access revoked');
  if (siteId) revalidatePath(`/operator/buildsell/${siteId}`);
  return { ok: true, message: 'Access revoked.' };
}
