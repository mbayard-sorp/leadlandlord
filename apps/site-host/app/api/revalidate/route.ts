import type { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { parseBody } from 'next-sanity/webhook';

interface SanityWebhookBody {
  _type?: string;
  _id?: string;
  siteId?: string;
  slug?: { current?: string } | null;
  domains?: Array<{ host: string }> | null;
}

/** Tags accepted from the internal bust path. Prefix allowlist keeps a leaked
 * secret from busting arbitrary framework tags. */
const INTERNAL_TAG_PREFIXES = ['site:tracking:', 'cross-links', 'system-state', 'db:sites'];
const MAX_TAGS_PER_REQUEST = 100;

function isAllowedTag(tag: unknown): tag is string {
  return (
    typeof tag === 'string' &&
    tag.length > 0 &&
    tag.length <= 200 &&
    INTERNAL_TAG_PREFIXES.some((p) => tag === p || tag.startsWith(p))
  );
}

/**
 * Cache revalidation endpoint. Two callers, distinguished by auth style:
 *
 * 1. Internal tag bust (Track C): `Authorization: Bearer SANITY_REVALIDATE_SECRET`
 *    with JSON `{ "tags": ["system-state", "site:tracking:<id>", ...] }`.
 *    Used by the operator app (and manual curl) to bust the unstable_cache
 *    entries in lib/tracking.ts + lib/cross-links.ts ahead of their
 *    revalidate windows — e.g. the cross-link kill switch, or a tracking
 *    number swap.
 *
 * 2. Sanity webhook (signature-verified via next-sanity parseBody). Configure
 *    in Sanity Manage → API → Webhooks on _type in ['site','page','theme'].
 *    Still a no-op: lib/sanity.ts reads go through the Sanity CDN and are not
 *    tag-cached (cacheComponents tradeoff, see next.config.ts). The route
 *    stays in place so the webhook has a stable URL; wiring per-_type busts
 *    happens if/when the Cache Components pivot lands.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SANITY_REVALIDATE_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: 'SANITY_REVALIDATE_SECRET not configured' }, { status: 500 });
  }

  const auth = req.headers.get('authorization');
  if (auth === `Bearer ${secret}`) {
    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
    }
    const rawTags = (parsed as { tags?: unknown })?.tags;
    if (!Array.isArray(rawTags) || rawTags.length === 0) {
      return Response.json({ ok: false, error: 'body must be { tags: string[] }' }, { status: 400 });
    }
    const tags = rawTags.slice(0, MAX_TAGS_PER_REQUEST).filter(isAllowedTag);
    const rejected = rawTags.length - tags.length;
    // 'max' = expire the entry outright (the pre-Next-16 revalidateTag
    // behavior) so the next read refetches from Neon.
    for (const tag of tags) revalidateTag(tag, 'max');
    console.log('[revalidate] internal bust', { revalidated: tags, rejected });
    return Response.json({ ok: true, revalidated: tags, rejected });
  }

  const { isValidSignature, body } = await parseBody<SanityWebhookBody>(req, secret);
  if (!isValidSignature) {
    return Response.json({ ok: false, error: 'invalid signature' }, { status: 401 });
  }
  if (!body?._type) {
    return Response.json({ ok: false, error: 'missing _type' }, { status: 400 });
  }

  // Sanity content reads are CDN-backed, not tag-cached — see route doc above.
  void body;
  return Response.json({ ok: true, phase: 'sanity-noop' });
}
