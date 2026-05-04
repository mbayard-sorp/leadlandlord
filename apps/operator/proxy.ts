import { NextResponse, type NextRequest } from 'next/server';
import { verifySession, sessionCookieName } from './lib/auth';

/**
 * Next.js 16 proxy (replaces middleware.ts in earlier versions).
 *
 * Gates `/operator/*` behind the operator session cookie. Allows `/login`,
 * `/api/auth/*`, and `/api/cron/*` (which has its own HMAC verification).
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public paths.
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/cron/') ||
    pathname.startsWith('/api/lead') ||
    pathname.startsWith('/api/webhooks/') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // Everything under /operator requires a valid session cookie.
  if (pathname.startsWith('/operator') || pathname === '/') {
    const cookie = req.cookies.get(sessionCookieName())?.value;
    if (!verifySession(cookie)) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/cron|_next/static|_next/image|favicon.ico).*)'],
};
