import { log } from '@leadlandlord/shared/log';

/**
 * Best-effort cache-tag bust against site-host's POST /api/revalidate
 * (Track C). site-host caches its Neon reads (tracking numbers, cross-link
 * rows, the cross-link kill switch) in the data cache with revalidate
 * windows; this pushes changes through ahead of those windows.
 *
 * Env (operator side):
 *   SITE_HOST_REVALIDATE_URL    e.g. https://<site-host-deployment>/api/revalidate
 *   SITE_HOST_REVALIDATE_SECRET same value as site-host's SANITY_REVALIDATE_SECRET
 *
 * Fire-and-forget by design: a miss only means the change waits out the
 * revalidate window (5 min for system-state, 1h for tracking/cross-links),
 * so failures are logged and swallowed — never block the calling action.
 */
export async function bustSiteHostTags(tags: string[]): Promise<void> {
  const url = process.env.SITE_HOST_REVALIDATE_URL;
  const secret = process.env.SITE_HOST_REVALIDATE_SECRET;
  if (!url || !secret || tags.length === 0) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      log.warn({ status: res.status, tags }, 'site-host tag bust failed');
    }
  } catch (err) {
    log.warn({ err, tags }, 'site-host tag bust unreachable');
  }
}
