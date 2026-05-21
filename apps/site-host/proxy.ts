import { NextResponse, type NextRequest } from 'next/server';

/**
 * Hosts that route to the corporate marketing site (leadslandlord.com), not
 * the per-tenant renderer. `?corporate=1` is the dev fallback when DNS isn't
 * pointed at the local box.
 */
const CORPORATE_HOSTS = new Set(['leadslandlord.com', 'www.leadslandlord.com']);

/**
 * Next 16 proxy.ts — runs before the cache. Three responsibilities:
 *
 *  1. Mirror the Host header into `x-site-host` (always) so server components
 *     can read it via `headers()` even when Next strips/normalizes Host.
 *  2. Dev fallbacks for local Sanity testing without DNS:
 *       - `<slug>.localhost:3001`  → x-site-slug: <slug>
 *       - `?site=<slug>` query     → x-site-slug: <slug>
 *  3. Route corporate hosts (leadslandlord.com) into the /leadslandlord/*
 *     internal namespace so they don't collide with tenant routes at /, /about,
 *     /contact. Browser URLs stay clean — this is an internal rewrite.
 *
 * In production the Host header alone is enough — the site-doc has
 * `domains: [{ host }]` for every attached domain.
 */
export default function proxy(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const headers = new Headers(req.headers);
  headers.set('x-site-host', host);

  const hostNoPort = (host.split(':')[0] ?? '').toLowerCase();
  const isCorporateQuery = req.nextUrl.searchParams.get('corporate') === '1';
  // Sticky preview marker: nav links inside the corporate site are bare
  // (`/services`, `/privacy`, etc.) and lose `?corporate=1` on click. The
  // cookie keeps subsequent requests routed to the corporate namespace.
  // No-op in production once the real host serves traffic.
  const isCorporateCookie = req.cookies.get('ll_corp')?.value === '1';
  const isCorporate =
    CORPORATE_HOSTS.has(hostNoPort) || isCorporateQuery || isCorporateCookie;

  if (isCorporate) {
    headers.set('x-site-mode', 'corporate');
    const path = req.nextUrl.pathname;
    const passthrough =
      path.startsWith('/_next') ||
      path.startsWith('/api/revalidate') ||
      path.startsWith('/leadslandlord') ||
      path === '/favicon.ico' ||
      path === '/sitemap.xml' ||
      path === '/robots.txt';
    let res: NextResponse;
    if (!passthrough) {
      const url = req.nextUrl.clone();
      url.pathname = `/leadslandlord${path === '/' ? '' : path}`;
      res = NextResponse.rewrite(url, { request: { headers } });
    } else {
      res = NextResponse.next({ request: { headers } });
    }
    if (isCorporateQuery && !isCorporateCookie) {
      res.cookies.set('ll_corp', '1', {
        httpOnly: false,
        sameSite: 'lax',
        path: '/',
        // Session cookie — clears when the browser closes. Long enough to
        // browse the preview, short enough not to follow you forever.
      });
    }
    return res;
  }

  // IndexNow key file: GET /{32-hex}.txt → the per-host key handler. The
  // strict 32-hex pattern means it never shadows /robots.txt, /sitemap.xml,
  // real pages, or the [slug] route. Bing/Brave fetch this to verify ownership
  // before accepting URL submissions.
  const keyMatch = req.nextUrl.pathname.match(/^\/([a-f0-9]{32})\.txt$/);
  if (keyMatch) {
    const url = req.nextUrl.clone();
    url.pathname = '/api/indexnow-key';
    url.searchParams.set('k', keyMatch[1]!);
    return NextResponse.rewrite(url, { request: { headers } });
  }

  // dev: subdomain → slug
  const sub = matchLocalSubdomain(host);
  if (sub) headers.set('x-site-slug', sub);

  // dev/preview: ?site=foo → slug. Internal links on rendered pages are bare
  // (e.g. /about, /services/foo) so the query param drops on every nav unless
  // we sticky it via cookie. Same pattern as ?corporate=1 above. No-op in
  // production once a real domain is attached and the Host header carries
  // identity directly.
  const querySite = req.nextUrl.searchParams.get('site');
  const cookieSite = req.cookies.get('ll_site')?.value ?? null;
  const effectiveSlug = querySite ?? (cookieSite || null);
  if (effectiveSlug) headers.set('x-site-slug', effectiveSlug);

  const res = NextResponse.next({ request: { headers } });
  if (querySite && querySite !== cookieSite) {
    // Set/refresh the sticky cookie when a fresh ?site= comes in. Session-
    // scoped — clears when the browser closes.
    res.cookies.set('ll_site', querySite, {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
    });
  }
  return res;
}

function matchLocalSubdomain(host: string): string | null {
  // accept "<slug>.localhost", "<slug>.localhost:3001", "<slug>.lvh.me", etc.
  const m = host.match(/^([^.]+)\.(localhost|lvh\.me|nip\.io)(:\d+)?$/);
  return m?.[1] ?? null;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/revalidate).*)'],
};
