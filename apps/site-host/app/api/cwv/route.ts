import { headers } from 'next/headers';

/**
 * Same-origin proxy for Core Web Vitals beacons (ADR 0013).
 *
 * The browser fires navigator.sendBeacon('/api/cwv', ...) on page unload.
 * This route forwards to the operator app's /api/cwv, attaching
 * x-leadlandlord-host so the operator can resolve the site by host without
 * the payload needing to carry a siteId.
 *
 * No CORS needed — same-origin beacon. Operator route owns all validation,
 * volume-capping, and the Drizzle upsert.
 */
export async function POST(req: Request) {
  const operatorUrl = process.env.OPERATOR_PUBLIC_URL;
  if (!operatorUrl) {
    // Return 200 so sendBeacon doesn't retry — observability must never break the page.
    return new Response(null, { status: 200 });
  }
  const body = await req.text();
  const h = await headers();
  const host = h.get('x-site-host') ?? h.get('host') ?? '';
  const upstream = await fetch(`${operatorUrl.replace(/\/$/, '')}/api/cwv`, {
    method: 'POST',
    headers: {
      'content-type': req.headers.get('content-type') ?? 'application/json',
      'x-leadlandlord-host': host,
    },
    body,
  });
  // sendBeacon ignores the response body; return 200 regardless so retries don't pile up.
  return new Response(null, { status: upstream.ok ? 200 : 200 });
}
