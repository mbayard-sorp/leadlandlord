import { NextResponse, type NextRequest } from 'next/server';

/**
 * Hosts that route to the corporate marketing site (leadslandlord.com), not
 * the per-tenant renderer. `?corporate=1` is the dev fallback when DNS isn't
 * pointed at the local box.
 */
const CORPORATE_HOSTS = new Set(['leadslandlord.com', 'www.leadslandlord.com']);

/**
 * Custom Sites (ADR 0033) — client-owned standalone sites with zero operator
 * coupling. `CUSTOM_HOSTS` maps a client's domain(s) to its `csSite.siteKey`.
 * `?cs=<siteKey>` is the dev fallback, sticky via the `ll_cs` cookie — same
 * mechanics as `?corporate=1`/`ll_corp` above.
 */
const CUSTOM_HOSTS = new Map<string, string>([
  ['constructionadrservices.com', 'constructionadr'],
  ['www.constructionadrservices.com', 'constructionadr'],
]);

/**
 * siteKey -> internal app/ namespace folder. A small map (not a hardcoded
 * literal) so site #2 is additive per ADR 0033 D1: add one CUSTOM_HOSTS entry
 * + one CUSTOM_NAMESPACES entry + one app/ folder, nothing else changes.
 */
const CUSTOM_NAMESPACES: Record<string, string> = {
  constructionadr: 'cadr',
};

/**
 * Next 16 proxy.ts — runs before the cache. Four responsibilities:
 *
 *  1. Mirror the Host header into `x-site-host` (always) so server components
 *     can read it via `headers()` even when Next strips/normalizes Host.
 *  2. Dev fallbacks for local Sanity testing without DNS:
 *       - `<slug>.localhost:3001`  → x-site-slug: <slug>
 *       - `?site=<slug>` query     → x-site-slug: <slug>
 *  3. Route corporate hosts (leadslandlord.com) into the /leadslandlord/*
 *     internal namespace so they don't collide with tenant routes at /, /about,
 *     /contact. Browser URLs stay clean — this is an internal rewrite.
 *  4. Route Custom Sites hosts (CUSTOM_HOSTS) into their own internal
 *     namespace (e.g. /cadr/*) the same way, tagging the request
 *     `x-site-mode: custom` + `x-cs-site: <siteKey>` for downstream resolvers.
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
      // See the Custom Sites branch below: all route handlers are top-level.
      path.startsWith('/api') ||
      path.startsWith('/leadslandlord') ||
      path.startsWith('/preview') ||
      path.startsWith('/buildsell') ||
      path === '/favicon.ico' ||
      path === '/sitemap.xml' ||
      path === '/robots.txt' ||
      path === '/llms.txt' ||
      path === '/llms-full.txt';
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

  // Custom Sites (ADR 0033): host match, or dev fallback via ?cs=<siteKey>
  // made sticky via the ll_cs cookie so internal nav links (bare
  // `/practice-areas`, `/contact`, etc.) stay routed after the first click
  // drops the query param.
  const customQueryKey = req.nextUrl.searchParams.get('cs');
  const customCookieKey = req.cookies.get('ll_cs')?.value ?? null;
  const csSiteKey = CUSTOM_HOSTS.get(hostNoPort) ?? customQueryKey ?? customCookieKey ?? null;
  const csNamespace = csSiteKey ? CUSTOM_NAMESPACES[csSiteKey] : undefined;

  if (csSiteKey && csNamespace) {
    headers.set('x-site-mode', 'custom');
    headers.set('x-cs-site', csSiteKey);

    // IndexNow key file, replicated ahead of the namespace rewrite below —
    // same pattern as the shared handler further down, but this branch
    // returns early so it can't fall through to it.
    const csKeyMatch = req.nextUrl.pathname.match(/^\/([a-f0-9]{32})\.txt$/);
    if (csKeyMatch) {
      const url = req.nextUrl.clone();
      url.pathname = '/api/indexnow-key';
      url.searchParams.set('k', csKeyMatch[1]!);
      return NextResponse.rewrite(url, { request: { headers } });
    }

    // .md rewrite, replicated ahead of the namespace rewrite for the same
    // reason. /index.md -> /md (home), /foo.md -> /md/foo.
    const csMdMatch = req.nextUrl.pathname.match(/^(\/.*?)\.md$/);
    if (csMdMatch) {
      const inner = csMdMatch[1] === '/index' ? '' : csMdMatch[1];
      const url = req.nextUrl.clone();
      url.pathname = `/md${inner}`;
      return NextResponse.rewrite(url, { request: { headers } });
    }

    const path = req.nextUrl.pathname;
    const passthrough =
      path.startsWith('/_next') ||
      // Every route handler lives at top-level /api/* — no namespace has an
      // api/ folder — so rewriting /api/x to /<ns>/api/x is always a 404.
      path.startsWith('/api') ||
      path.startsWith(`/${csNamespace}`) ||
      // Shared-host escapes, same as the corporate branch above. `ll_cs` is a
      // sticky session cookie, so once a browser has previewed a Custom Site on
      // leadlandlord-sites.vercel.app every later request on that host lands
      // here — including B&S draft/live links, which live outside the namespace
      // and would otherwise rewrite to /<ns>/preview/... and 404.
      path.startsWith('/preview') ||
      path.startsWith('/buildsell') ||
      path === '/favicon.ico' ||
      path === '/sitemap.xml' ||
      path === '/robots.txt' ||
      path === '/llms.txt' ||
      path === '/llms-full.txt' ||
      path === '/md' ||
      path.startsWith('/md/');
    let res: NextResponse;
    if (!passthrough) {
      const url = req.nextUrl.clone();
      url.pathname = `/${csNamespace}${path === '/' ? '' : path}`;
      res = NextResponse.rewrite(url, { request: { headers } });
    } else {
      res = NextResponse.next({ request: { headers } });
    }
    if (customQueryKey && customQueryKey !== customCookieKey) {
      res.cookies.set('ll_cs', customQueryKey, {
        httpOnly: false,
        sameSite: 'lax',
        path: '/',
        // Session cookie — same rationale as ll_corp/ll_site above.
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

  // Rewrite *.md paths to the internal /md/* route handler for AI crawlers.
  // /index.md -> /md (home), /foo.md -> /md/foo, /a/b.md -> /md/a/b.
  // Runs after slug detection so the rewrite carries x-site-slug in dev.
  // Skip _next/static, api, and other internal paths (already guarded by matcher).
  const mdMatch = req.nextUrl.pathname.match(/^(\/.*?)\.md$/);
  if (mdMatch) {
    const inner = mdMatch[1] === '/index' ? '' : mdMatch[1];
    const url = req.nextUrl.clone();
    url.pathname = `/md${inner}`;
    return NextResponse.rewrite(url, { request: { headers } });
  }

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
