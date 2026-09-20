/**
 * Server-side Neon Auth provisioning helper.
 *
 * Ensures a Neon Auth user exists for the given email and inserts an active
 * `bs_customer_site_access` row, returning the auth user id.
 *
 * IMPORTANT: The `auth` client instance is lazily initialized inside the
 * function so that importing this module does NOT throw when
 * NEON_AUTH_BASE_URL / NEON_AUTH_COOKIE_SECRET are absent. Env vars are not
 * yet provisioned in all environments; typecheck and build MUST pass without
 * them.
 *
 * Auth API used: @neondatabase/auth v0.4.2-beta (Better Auth under the hood).
 * createAuthClient(url) -> VanillaBetterAuthClient with:
 *   .signUp.email({ email, password, name }) -> { data: { user: { id } } | null, error }
 *   .signIn.email({ email, password, callbackURL })  (not used here)
 *
 * Server-side provisioning WITHOUT a live browser session: we call
 * signUp.email() with a random password. If the user already exists the call
 * returns an error (code USER_ALREADY_EXISTS or similar); we then fall back to
 * a direct SQL lookup against neon_auth.user (Better Auth's actual table name).
 */

import { getDb } from '@leadlandlord/db/client';
import { bsCustomerSiteAccess } from '@leadlandlord/db';
import { sql } from 'drizzle-orm';
import { log } from '@leadlandlord/shared/log';
import { sendEmail } from './resend/index';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Public origin of the customer portal, used in the welcome email.
 *
 * The default is a subdomain of `leadslandlord.com` (note the `s`). The
 * earlier hard-coded `edit.leadlandlord.com` is a domain we do not own, so
 * every welcome email sent before this fix pointed customers at a third
 * party's parked domain.
 *
 * Read at call time (not module scope) so a deployment can set it without
 * depending on import order.
 */
function customerPortalUrl(): string {
  const configured = process.env.CUSTOMER_PORTAL_URL?.trim();
  const base = configured && configured.length > 0
    ? configured
    : 'https://edit.leadslandlord.com';
  return base.replace(/\/+$/, '');
}

/**
 * Looks up a Neon Auth user id by email using a parameterised query.
 *
 * Neon Auth (managed Better Auth) stores users in `neon_auth.user` (singular) —
 * confirmed against the live schema. Throws on unexpected errors so we never
 * silently grant access.
 */
async function findExistingUserIdByEmail(email: string): Promise<string | null> {
  const db = getDb();

  const rows = await db.execute(
    sql`SELECT id FROM neon_auth.user WHERE email = ${email} LIMIT 1`,
  );

  const firstRow = Array.isArray(rows)
    ? rows[0]
    : (rows as { rows?: unknown[] }).rows?.[0];
  if (!firstRow) return null;
  const id = (firstRow as Record<string, unknown>)['id'];
  return typeof id === 'string' ? id : null;
}

// ---------------------------------------------------------------------------

export interface ProvisionCustomerAccessArgs {
  ownerEmail: string;
  businessName: string;
  siteId: string;
  grantedBy: 'operator' | 'auto-markpaid';
}

/**
 * Ensure a Neon Auth user exists for ownerEmail and insert an active access
 * row for siteId. Returns the auth user id (UUID string).
 *
 * Non-fatal welcome email is sent via Resend after the access row is written.
 */
export async function provisionCustomerAccess({
  ownerEmail,
  businessName,
  siteId,
  grantedBy,
}: ProvisionCustomerAccessArgs): Promise<string> {
  const neonAuthBaseUrl = process.env.NEON_AUTH_BASE_URL;
  if (!neonAuthBaseUrl) {
    throw new Error(
      'NEON_AUTH_BASE_URL env var is required for customer provisioning. ' +
      'Set it in .env.local / Vercel environment variables.',
    );
  }

  // Lazy import keeps the module importable even when the package is not yet
  // installed or env vars are absent at module evaluation time.
  const { createAuthClient } = await import('@neondatabase/auth');

  // Lazily initialize the auth client inside the function (per spec: do NOT
  // initialize at module top level so import is safe without env vars).
  const authClient = createAuthClient(neonAuthBaseUrl);

  let authUserId: string | null = null;

  // Attempt to create the user via signUp.email. A random password is used;
  // the customer will use "Forgot password" to set their own credentials.
  //
  // A server-to-server fetch sends no Origin header, and Better Auth rejects
  // that with "Origin header is required when callbackURL is not an absolute
  // URL", which is why every provisioning call failed and live sites ended up
  // with an owner_email and no portal account. We therefore send the portal
  // origin explicitly.
  //
  // NOTE: the origin must be registered as a trusted origin in the Neon Auth
  // project settings, or the service answers 403 "Invalid origin"
  // (code: feature_not_supported) and no user can be created. Granting access
  // to an ALREADY-EXISTING user still works in that state, via the SQL
  // fallback below.
  const randomPassword = crypto.randomUUID();

  // signUp can either RETURN `{ error }` or THROW, depending on the failure.
  // Both mean the same thing here: fall through to the SQL lookup, because
  // the most common cause is that the user already exists. Letting a throw
  // escape skipped the fallback entirely.
  let signUpResult: {
    data?: { user?: { id?: string } } | null;
    error?: { message?: string } | null;
  } = {};
  let signUpThrew: unknown = null;
  try {
    signUpResult = await authClient.signUp.email({
      email: ownerEmail,
      password: randomPassword,
      name: businessName,
      fetchOptions: { headers: { origin: customerPortalUrl() } },
    });
  } catch (err) {
    signUpThrew = err;
    log.warn(
      { ownerEmail, err },
      'provisionCustomerAccess: signUp.email threw, falling back to SQL lookup',
    );
  }

  if (signUpResult.data?.user?.id) {
    authUserId = signUpResult.data.user.id;
    log.info({ ownerEmail, authUserId }, 'provisionCustomerAccess: new Neon Auth user created');
  } else {
    // User likely already exists. Fall back to SQL lookup against the
    // neon_auth.user table (Better Auth's actual table name in the managed
    // Neon Auth service; the schema is neon_auth).
    const errorMsg =
      signUpResult.error?.message ??
      (signUpThrew instanceof Error ? signUpThrew.message : null) ??
      String(signUpResult.error ?? signUpThrew);
    log.info(
      { ownerEmail, error: errorMsg },
      'provisionCustomerAccess: signUp failed, attempting SQL lookup (user may already exist)',
    );

    authUserId = await findExistingUserIdByEmail(ownerEmail);
    if (!authUserId) {
      throw new Error(
        `provisionCustomerAccess: signUp failed and SQL lookup found no user for ${ownerEmail}. ` +
        `signUp error: ${errorMsg}`,
      );
    }
    log.info({ ownerEmail, authUserId }, 'provisionCustomerAccess: existing Neon Auth user resolved via SQL');
  }

  // Upsert the access row. ON CONFLICT DO NOTHING (unique on auth_user_id +
  // buildsell_site_id) makes re-granting safe (idempotent). We do NOT clear
  // revoked_at on a conflict — if the row was revoked, the operator must
  // explicitly re-grant via the CustomerAccessPanel.
  const db = getDb();
  await db
    .insert(bsCustomerSiteAccess)
    .values({
      authUserId,
      buildsellSiteId: siteId,
      grantedBy,
    })
    .onConflictDoNothing();

  log.info({ authUserId, siteId, grantedBy }, 'provisionCustomerAccess: access row inserted (or already exists)');

  // Non-fatal welcome email. Failure here MUST NOT block the go-live path.
  try {
    const fromAddress = process.env.RESEND_FROM_ADDRESS;
    if (fromAddress) {
      await sendEmail({
        to: ownerEmail,
        from: fromAddress,
        subject: 'Your website editor is ready',
        text: [
          `Hi ${businessName},`,
          '',
          `Your website editor is ready at ${customerPortalUrl()}`,
          '',
          'Sign in with this email address and use "Forgot Password" to set your password.',
          '',
          'Questions? Just reply to this email.',
        ].join('\n'),
      });
      log.info({ ownerEmail }, 'provisionCustomerAccess: welcome email sent');
    } else {
      log.warn({ ownerEmail }, 'provisionCustomerAccess: RESEND_FROM_ADDRESS not set — welcome email skipped');
    }
  } catch (err) {
    log.warn({ ownerEmail, siteId, err }, 'provisionCustomerAccess: welcome email failed (non-fatal)');
  }

  return authUserId;
}
