import { headers } from 'next/headers';
import { resolveCurrentSite } from '../../../lib/site-context';
import { resolveCurrentCustomSite } from '../../../lib/custom-site-context';

/**
 * IndexNow key-verification file. `proxy.ts` rewrites `GET /{key}.txt` to this
 * handler with the key in `?k=`. Returns the current host's IndexNow key as
 * text/plain when the requested key matches the one stored on Sanity; 404
 * otherwise. Bing and Brave fetch this URL to verify ownership before
 * accepting URL submissions.
 *
 * Branches on `x-site-mode` (set by proxy.ts for every mode, ADR 0033 D1) so
 * Custom Sites resolve via `csSite.indexnowKey` instead of the tenant-only
 * `site.indexnowKey` — the other host modes still hit `resolveCurrentSite()`.
 * Per ADR 0033 Amendment 1 D7: this is the missing half of proxy.ts's
 * `/{32hex}.txt` rewrite, which already tags custom-host requests before
 * they reach here.
 *
 * force-dynamic because the response depends on the resolved host. The 24h
 * Cache-Control lets the edge serve repeat verification fetches without a
 * Sanity round-trip (a cold start here can otherwise surface as a 403 from
 * IndexNow when the bot validates the key file).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const requested = new URL(req.url).searchParams.get('k');
  const h = await headers();

  const key =
    h.get('x-site-mode') === 'custom'
      ? (await resolveCurrentCustomSite())?.indexnowKey
      : (await resolveCurrentSite())?.indexnowKey;

  if (!key || !requested || requested !== key) {
    return new Response('Not found', { status: 404 });
  }
  return new Response(key, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
