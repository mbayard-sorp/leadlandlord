import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendEmail } from '@leadlandlord/integrations/resend';
import {
  fetchCustomSiteByHost,
  fetchCustomSiteByKey,
  type CustomSite,
} from '../../../lib/customsites-sanity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Custom Sites lead endpoint (ADR 0033 D4).
 *
 * Client contract (apps/site-host/components/customsites/ContactForm.tsx):
 *   POST { siteKey, firstName, lastName, email, phone?, message, company }
 *   -> 200 { ok: true } | 4xx/5xx { error: string }
 *
 * No Postgres row, no agent_events row — csSite in Sanity is resolved
 * directly and the lead is forwarded to csSite.leadRecipients via Resend.
 * `company` is the honeypot field (hidden in the form via CSS); a non-empty
 * value means bot, and we silently report success without sending.
 *
 * The form posts same-origin through apps/site-host/proxy.ts (custom hosts
 * passthrough /api/cs-lead to this route directly), so no CORS handling is
 * needed here.
 */

// ---------------------------------------------------------------------------
// Per-IP + per-siteKey sliding-window rate limiter.
//
// Copied from apps/operator/app/api/bs/lead/route.ts rather than shared,
// because that route is Postgres-coupled (buildsell_sites) and this one is
// deliberately not (ADR 0033 D4) — no shared package seam exists between
// them and creating one for a ~30-line limiter isn't worth the coupling.
// ---------------------------------------------------------------------------
/** Max requests per IP within RATE_WINDOW_MS. */
const IP_RATE_LIMIT = 10;
/** Max requests per siteKey within RATE_WINDOW_MS. */
const SITE_RATE_LIMIT = 20;
/** Sliding window length in milliseconds. */
const RATE_WINDOW_MS = 60_000;

/**
 * In-memory store: key -> array of request timestamps (ms) within the window.
 * Module-level so it persists across requests on the same Node.js instance.
 * On Vercel, each serverless instance is isolated, which is acceptable — the
 * limits guard against burst on a single instance, not distributed flood.
 */
const _rateBuckets = new Map<string, number[]>();

/**
 * Returns true if the request should be rate-limited (bucket exceeded).
 * Mutates the bucket on allow.
 */
function checkRateLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const bucket = _rateBuckets.get(key) ?? [];
  // Prune timestamps outside the current window.
  const trimmed = bucket.filter((t) => t > cutoff);
  if (trimmed.length >= limit) {
    // Do not record this request — just reject.
    _rateBuckets.set(key, trimmed);
    return true; // rate-limited
  }
  trimmed.push(now);
  _rateBuckets.set(key, trimmed);
  return false;
}

/**
 * Safely extract the client IP from the forwarded header Vercel sets.
 * Takes only the first address in the comma-separated list; strips port.
 * Never returns an empty string — falls back to "unknown".
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0];
    if (first) {
      return first.trim().replace(/^\[/, '').replace(/\]:\d+$/, '').replace(/:\d+$/, '') || 'unknown';
    }
  }
  return 'unknown';
}

const Body = z.object({
  siteKey: z.string().trim().min(1).max(120),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().max(40).optional(),
  message: z.string().trim().min(1).max(4000),
  /** Honeypot — non-empty means bot. */
  company: z.string().nullish(),
});

/**
 * Resolve the csSite for this request. Prefers the Host header (set by
 * proxy.ts as x-site-host on every request) so a spoofed siteKey in the body
 * can't be used to redirect leads to a different site's recipients; falls
 * back to the body's siteKey for local/dev requests where the host isn't a
 * registered custom domain.
 */
async function resolveCsSite(req: Request, siteKey: string): Promise<CustomSite | null> {
  const hostHeader = req.headers.get('x-site-host');
  if (hostHeader) {
    const byHost = await fetchCustomSiteByHost(hostHeader);
    if (byHost) return byHost;
  }
  return fetchCustomSiteByKey(siteKey);
}

export async function POST(req: Request) {
  let payload: z.infer<typeof Body>;
  try {
    payload = Body.parse(await req.json());
  } catch (err) {
    console.warn('cs-lead: invalid payload', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  // Honeypot tripped — silently succeed without sending anything.
  if (payload.company && payload.company.trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  // Rate limiting: per-IP and per-site burst protection.
  const clientIp = getClientIp(req);
  if (checkRateLimit(`ip:${clientIp}`, IP_RATE_LIMIT)) {
    console.warn('cs-lead: rate limited (ip)', { clientIp });
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (checkRateLimit(`site:${payload.siteKey}`, SITE_RATE_LIMIT)) {
    console.warn('cs-lead: rate limited (site)', { siteKey: payload.siteKey });
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const csSite = await resolveCsSite(req, payload.siteKey);
  if (!csSite || !csSite.leadRecipients || csSite.leadRecipients.length === 0) {
    console.warn('cs-lead: site not found or no lead recipients', { siteKey: payload.siteKey });
    return NextResponse.json({ error: 'site_not_found' }, { status: 404 });
  }

  const submitterName = `${payload.firstName} ${payload.lastName}`.trim();
  const sourceHost = req.headers.get('x-site-host') ?? req.headers.get('host') ?? 'unknown';
  const lines = [
    `Name: ${submitterName}`,
    `Email: ${payload.email}`,
    `Phone: ${payload.phone ?? '—'}`,
    '',
    'Message:',
    payload.message,
    '',
    `Source: ${sourceHost}`,
    `Submitted: ${new Date().toISOString()}`,
  ];

  try {
    await sendEmail({
      to: csSite.leadRecipients,
      from: process.env.RESEND_FROM_ADDRESS ?? '',
      subject: `New inquiry from ${submitterName} - ${csSite.name}`,
      text: lines.join('\n'),
      replyTo: payload.email,
    });
  } catch (err) {
    // No PII beyond what the form already carries (name/email are the
    // submitter's own, already in the failed email's payload).
    console.error('cs-lead: resend send failed', {
      siteKey: payload.siteKey,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'delivery_failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
