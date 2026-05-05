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
  const isCorporate = CORPORATE_HOSTS.has(hostNoPort) || isCorporateQuery;

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
    if (!passthrough) {
      const url = req.nextUrl.clone();
      url.pathname = `/leadslandlord${path === '/' ? '' : path}`;
      return NextResponse.rewrite(url, { request: { headers } });
    }
    return NextResponse.next({ request: { headers } });
  }

  // dev: subdomain → slug
  const sub = matchLocalSubdomain(host);
  if (sub) headers.set('x-site-slug', sub);

  // dev: ?site=foo → slug (overrides subdomain)
  const querySite = req.nextUrl.searchParams.get('site');
  if (querySite) headers.set('x-site-slug', querySite);

  return NextResponse.next({ request: { headers } });
}

function matchLocalSubdomain(host: string): string | null {
  // accept "<slug>.localhost", "<slug>.localhost:3001", "<slug>.lvh.me", etc.
  const m = host.match(/^([^.]+)\.(localhost|lvh\.me|nip\.io)(:\d+)?$/);
  return m?.[1] ?? null;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/revalidate).*)'],
};
