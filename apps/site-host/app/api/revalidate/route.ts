import type { NextRequest } from 'next/server';
import { parseBody } from 'next-sanity/webhook';

interface SanityWebhookBody {
  _type?: string;
  _id?: string;
  siteId?: string;
  slug?: { current?: string } | null;
  domains?: Array<{ host: string }> | null;
}

/**
 * Sanity revalidation webhook. Configure in Sanity Manage → API → Webhooks
 * to POST here on any change to _type in ['site','page','theme'] and sign
 * with the SANITY_REVALIDATE_SECRET env var.
 *
 * Tag busting is granular:
 *   - site doc change → bust each domains[].host + the slug
 *   - page doc change → bust the parent site's host (project resolves pages
 *                       through the site doc, so site:host:* covers it)
 *   - theme doc change → broad bust by tag prefix (rare, manual ops only)
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SANITY_REVALIDATE_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: 'SANITY_REVALIDATE_SECRET not configured' }, { status: 500 });
  }

  const { isValidSignature, body } = await parseBody<SanityWebhookBody>(req, secret);
  if (!isValidSignature) {
    return Response.json({ ok: false, error: 'invalid signature' }, { status: 401 });
  }
  if (!body?._type) {
    return Response.json({ ok: false, error: 'missing _type' }, { status: 400 });
  }

  // Phase B: signature is verified, but tag-bust is a no-op since lib/sanity.ts
  // doesn't yet wrap reads in `'use cache'` (cacheComponents tradeoff). The
  // route stays in place so Sanity webhooks have a stable URL to POST to,
  // and Track C wires up the actual revalidateTag calls per body._type.
  void body;
  return Response.json({ ok: true, phase: 'B-noop' });
}
