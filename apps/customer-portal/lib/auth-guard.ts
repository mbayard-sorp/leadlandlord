import 'server-only';

/**
 * Authorization guard for the customer portal.
 *
 * Every server action and page that touches a specific site must call
 * `requireCustomerSiteAccess(siteId)` first. The guard is fail-closed:
 * - No session       -> UnauthorizedError (redirect to /login)
 * - No active grant  -> ForbiddenError (hard stop)
 *
 * `siteId` is always passed explicitly by the caller and checked BEFORE
 * any Sanity read, closing the IDOR vector.
 */

import { eq, and, isNull } from 'drizzle-orm';
import { getDb } from '@leadlandlord/db/client';
import { bsCustomerSiteAccess, buildsellSites } from '@leadlandlord/db/schema';
import { getCurrentUser } from './auth';

// ---------------------------------------------------------------------------
// Typed error classes
// ---------------------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super('Not authenticated');
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor() {
    super('Access denied');
    this.name = 'ForbiddenError';
  }
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * Verifies the current user has an active grant for `siteId`.
 * Throws `UnauthorizedError` if there is no session.
 * Throws `ForbiddenError` if there is no active `bs_customer_site_access` row.
 * Returns `{ userId }` on success.
 */
export async function requireCustomerSiteAccess(
  siteId: string,
): Promise<{ userId: string }> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();

  const db = getDb();
  const [row] = await db
    .select({ id: bsCustomerSiteAccess.id })
    .from(bsCustomerSiteAccess)
    .where(
      and(
        eq(bsCustomerSiteAccess.authUserId, user.id),
        eq(bsCustomerSiteAccess.buildsellSiteId, siteId),
        isNull(bsCustomerSiteAccess.revokedAt),
      ),
    )
    .limit(1);

  if (!row) throw new ForbiddenError();

  return { userId: user.id };
}

// ---------------------------------------------------------------------------
// Dashboard query
// ---------------------------------------------------------------------------

export interface AccessibleSite {
  id: string;
  businessName: string;
  slug: string | null;
  status: string;
}

/**
 * Returns the list of buildsell sites the current user has active access to.
 * Returns an empty array (not an error) when there is no session or no grants.
 */
export async function listAccessibleSites(): Promise<AccessibleSite[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const db = getDb();
  const rows = await db
    .select({
      id: buildsellSites.id,
      businessName: buildsellSites.businessName,
      slug: buildsellSites.slug,
      status: buildsellSites.status,
    })
    .from(bsCustomerSiteAccess)
    .innerJoin(
      buildsellSites,
      eq(bsCustomerSiteAccess.buildsellSiteId, buildsellSites.id),
    )
    .where(
      and(
        eq(bsCustomerSiteAccess.authUserId, user.id),
        isNull(bsCustomerSiteAccess.revokedAt),
      ),
    );

  return rows;
}
