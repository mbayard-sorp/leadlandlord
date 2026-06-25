import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js 16 proxy (replaces middleware.ts in earlier versions).
 *
 * Public paths (no auth required):
 *   /login                  - sign-in page
 *   /api/auth/*             - Neon Auth API route handler (session management)
 *   /preview/*              - rewrites to site-host; preview iframe must pass through
 *   /api/draft-mode/*       - rewrites to site-host; draft-mode enable/disable must pass through
 *   /_next/*                - Next.js internals
 *   /favicon.ico
 *
 * Everything else requires a session. The check here is a lightweight cookie
 * presence test (the Neon Auth session cookie name is `better-auth.session_token`
 * in production or `__Secure-better-auth.session_token` over HTTPS). The
 * authoritative guard is `requireCustomerSiteAccess` in server actions — this
 * redirect is UX only.
 *
 * We do NOT call auth().getSession() here because that would make an upstream
 * HTTP request on every request. Cookie presence is sufficient for the redirect
 * gate; the real authz happens inside each action.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public paths — allow unconditionally.
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth/') ||
    // Preview iframe rewrites — must pass through, site-host owns auth there.
    pathname.startsWith('/preview/') ||
    pathname.startsWith('/api/draft-mode/') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // Lightweight session check: Neon Auth sets the session cookie
  // `neon-auth.session_token`, prefixed with `__Secure-` in a secure context
  // (https, and localhost which browsers treat as secure). Match either form by
  // substring so the `__Secure-`/`__Host-` prefix never breaks the check.
  // This is a UX redirect only — the authoritative gate is the DB-backed
  // `requireCustomerSiteAccess` guard in every server action.
  const hasSession = req.cookies
    .getAll()
    .some((c) => c.name.includes('neon-auth.session_token'));

  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
