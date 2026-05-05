import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next 16 proxy.ts — runs before the cache. Two responsibilities:
 *
 *  1. Mirror the Host header into `x-site-host` (always) so server components
 *     can read it via `headers()` even when Next strips/normalizes Host.
 *  2. Dev fallbacks for local Sanity testing without DNS:
 *       - `<slug>.localhost:3001`  → x-site-slug: <slug>
 *       - `?site=<slug>` query     → x-site-slug: <slug>
 *
 * In production the Host header alone is enough — the site-doc has
 * `domains: [{ host }]` for every attached domain.
 */
export default function proxy(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const headers = new Headers(req.headers);
  headers.set('x-site-host', host);

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
