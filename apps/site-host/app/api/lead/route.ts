import { headers } from 'next/headers';

/**
 * Same-origin proxy for lead-form submissions.
 *
 * The browser POSTs to /api/lead (same origin as the rendered page); this
 * route forwards to the operator app's /api/lead, attaching x-leadlandlord-host
 * so the operator can resolve the site by host even when the client-side
 * payload omits site_id (defense-in-depth).
 */
export async function POST(req: Request) {
  const operatorUrl = process.env.OPERATOR_PUBLIC_URL;
  if (!operatorUrl) {
    return Response.json({ ok: false, error: 'OPERATOR_PUBLIC_URL not configured' }, { status: 500 });
  }
  const body = await req.text();
  const h = await headers();
  const host = h.get('x-site-host') ?? h.get('host') ?? '';
  const upstream = await fetch(`${operatorUrl.replace(/\/$/, '')}/api/lead`, {
    method: 'POST',
    headers: {
      'content-type': req.headers.get('content-type') ?? 'application/json',
      'x-leadlandlord-host': host,
    },
    body,
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
