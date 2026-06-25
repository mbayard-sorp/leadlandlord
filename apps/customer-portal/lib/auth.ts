import 'server-only';

/**
 * Neon Auth server-side seam for the customer portal.
 *
 * Uses `@neondatabase/auth/next/server` which exports `createNeonAuth(config)`.
 * The returned object (`NeonAuth`) exposes all Better Auth server methods plus
 * `.handler()` (for the API route) and `.middleware()` (for proxy.ts).
 *
 * Session read: `await auth.getSession()` returns
 *   `{ data: { session: {...}, user: { id, email, name, ... } } | null, error }`.
 *
 * Lazy init: the `auth` singleton is created on first call so importing this
 * module during build/typecheck (when env vars are absent) does NOT throw.
 *
 * Required env vars at runtime:
 *   NEON_AUTH_BASE_URL      — e.g. https://ep-xxxx.neonauth.us-east-1.aws.neon.tech
 *   NEON_AUTH_COOKIE_SECRET — random string, at least 32 characters
 */

import { createNeonAuth, type NeonAuth } from '@neondatabase/auth/next/server';

let _auth: NeonAuth | null = null;

function getAuth(): NeonAuth {
  if (_auth) return _auth;

  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;

  if (!baseUrl || !secret) {
    throw new Error(
      'Neon Auth is not configured. Set NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET.',
    );
  }
  if (secret.length < 32) {
    throw new Error('NEON_AUTH_COOKIE_SECRET must be at least 32 characters.');
  }

  _auth = createNeonAuth({
    baseUrl,
    cookies: { secret },
  });
  return _auth;
}

/**
 * Returns the auth singleton. Safe to call in RSC, Server Actions, and Route
 * Handlers. Throws if env vars are absent (fail-closed).
 */
export function auth(): NeonAuth {
  return getAuth();
}

/**
 * Reads the current session from the incoming request cookies.
 * Returns `{ id, email }` for the authenticated user, or `null`.
 *
 * Call from Server Components and Server Actions — never from Client Components.
 */
export async function getCurrentUser(): Promise<{ id: string; email: string } | null> {
  const { data, error } = await getAuth().getSession();
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email };
}
