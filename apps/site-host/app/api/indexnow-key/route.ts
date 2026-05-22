import { resolveCurrentSite } from '../../../lib/site-context';

/**
 * IndexNow key-verification file. `proxy.ts` rewrites `GET /{key}.txt` to this
 * handler with the key in `?k=`. Returns the current host's IndexNow key as
 * text/plain when the requested key matches the one stored on the Sanity site
 * doc; 404 otherwise. Bing and Brave fetch this URL to verify ownership before
 * accepting URL submissions.
 *
 * force-dynamic because the response depends on the resolved host. The 24h
 * Cache-Control lets the edge serve repeat verification fetches without a
 * Sanity round-trip (a cold start here can otherwise surface as a 403 from
 * IndexNow when the bot validates the key file).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const requested = new URL(req.url).searchParams.get('k');
  const site = await resolveCurrentSite();
  const key = site?.indexnowKey;
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
