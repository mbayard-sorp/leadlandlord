import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import {
  getDb,
  buildsellSites,
  buildsellSiteLeads,
  type BuildsellSite,
  type BuildsellSiteLead,
} from '@leadlandlord/db';
import { sendEmail } from '@leadlandlord/integrations/resend';
import { createOrUpdateProfile, subscribeProfileToList } from '@leadlandlord/integrations/klaviyo';
import { log } from '@leadlandlord/shared/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Per-IP + per-site sliding-window rate limiter
// ---------------------------------------------------------------------------
/** Max requests per IP within RATE_WINDOW_MS. */
const IP_RATE_LIMIT = 10;
/** Max requests per buildsell_site_id within RATE_WINDOW_MS. */
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
      // Strip IPv6 brackets and optional port.
      return first.trim().replace(/^\[/, '').replace(/\]:\d+$/, '').replace(/:\d+$/, '') || 'unknown';
    }
  }
  return 'unknown';
}

/**
 * Build & Sell draft contact-form endpoint.
 *
 * The spec-site ContactBlock on /preview/[id] and /buildsell/[slug] POSTs here.
 * Pipeline:
 *   1. Validate + honeypot check
 *   2. Resolve buildsell_sites row
 *   3. Insert buildsellSiteLeads with forwardStatus:'pending'
 *   4. Return 200 immediately
 *   5. after() → forward to site.ownerEmail via Resend (skipped if no key/owner)
 *              → push to Klaviyo (skipped if no key/list)
 */

const Body = z.object({
  buildsell_site_id: z.string().uuid(),
  name: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().max(160).optional(),
  message: z.string().max(2000).optional(),
  /** Honeypot — non-empty means bot. */
  website: z.string().nullish(),
});

export async function OPTIONS() {
  return corsResponse(new NextResponse(null, { status: 204 }));
}

export async function POST(req: Request) {
  let payload: z.infer<typeof Body>;
  try {
    payload = Body.parse(await req.json());
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'bs/lead: invalid payload');
    return corsResponse(
      NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 }),
    );
  }

  // Honeypot tripped — silently succeed without writing anything.
  if (payload.website && payload.website.trim().length > 0) {
    return corsResponse(NextResponse.json({ ok: true }));
  }

  // Rate limiting: per-IP and per-site burst protection.
  const clientIp = getClientIp(req);
  if (checkRateLimit(`ip:${clientIp}`, IP_RATE_LIMIT)) {
    log.warn({ siteId: payload.buildsell_site_id }, 'bs/lead: rate limited (ip)');
    return corsResponse(
      NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 }),
    );
  }
  if (checkRateLimit(`site:${payload.buildsell_site_id}`, SITE_RATE_LIMIT)) {
    log.warn({ siteId: payload.buildsell_site_id }, 'bs/lead: rate limited (site)');
    return corsResponse(
      NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 }),
    );
  }

  const db = getDb();

  // Resolve the buildsell_sites row
  const siteRows = await db
    .select()
    .from(buildsellSites)
    .where(eq(buildsellSites.id, payload.buildsell_site_id))
    .limit(1);

  const site = siteRows[0];
  if (!site) {
    log.warn({ buildsell_site_id: payload.buildsell_site_id }, 'bs/lead: site not found');
    return corsResponse(
      NextResponse.json({ ok: false, error: 'site_not_found' }, { status: 404 }),
    );
  }

  // Insert lead row with forwardStatus pending
  const inserted = (
    await db
      .insert(buildsellSiteLeads)
      .values({
        buildsellSiteId: site.id,
        name: payload.name,
        phone: payload.phone,
        email: payload.email,
        message: payload.message,
        source: 'contact',
        forwardStatus: 'pending',
      })
      .returning()
  )[0];

  if (!inserted) {
    log.error({ siteId: site.id }, 'bs/lead: insert returned no rows');
    return corsResponse(
      NextResponse.json({ ok: false, error: 'insert_failed' }, { status: 500 }),
    );
  }

  log.info({ leadId: inserted.id, siteId: site.id }, 'bs/lead: captured');

  // Fan out without blocking the response
  after(() => {
    void forwardToOwner(inserted, site, payload.email);
    void forwardToKlaviyo(inserted, site, payload.email, payload.phone);
  });

  return corsResponse(NextResponse.json({ ok: true, lead_id: inserted.id }));
}

async function forwardToOwner(
  lead: BuildsellSiteLead,
  site: BuildsellSite,
  submitterEmail?: string,
): Promise<void> {
  const db = getDb();

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_ADDRESS;

  if (!apiKey || !from || !site.ownerEmail) {
    await db
      .update(buildsellSiteLeads)
      .set({ forwardStatus: 'skipped' })
      .where(eq(buildsellSiteLeads.id, lead.id))
      .execute();
    return;
  }

  try {
    const subject = `New inquiry for ${site.businessName}`;
    const lines = [
      `Business: ${site.businessName} (${site.trade} · ${site.city}, ${site.state})`,
      '',
      `Name: ${lead.name ?? '—'}`,
      `Phone: ${lead.phone ?? '—'}`,
      `Email: ${submitterEmail ?? '—'}`,
      '',
      'Message:',
      lead.message ?? '(none)',
    ];

    await sendEmail({
      to: site.ownerEmail,
      from,
      subject,
      text: lines.join('\n'),
      replyTo: submitterEmail,
    });

    await db
      .update(buildsellSiteLeads)
      .set({ forwardStatus: 'sent' })
      .where(eq(buildsellSiteLeads.id, lead.id))
      .execute();
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : err, leadId: lead.id },
      'bs/lead: forward to owner failed',
    );
    await db
      .update(buildsellSiteLeads)
      .set({ forwardStatus: 'failed' })
      .where(eq(buildsellSiteLeads.id, lead.id))
      .execute();
  }
}

/**
 * Push a B&S lead onto the site's Klaviyo list.
 *
 * `site.klaviyoListId` is set eagerly at build time by spec-site-builder
 * (see ensureKlaviyoListForBuildSell) — there is no lazy/on-demand list
 * creation here. If it's still null, the build-time provisioning was skipped
 * (no API key) or failed; this just records 'skipped' and moves on.
 */
async function forwardToKlaviyo(
  lead: BuildsellSiteLead,
  site: BuildsellSite,
  submitterEmail?: string,
  submitterPhone?: string,
): Promise<void> {
  const db = getDb();

  if (!process.env.KLAVIYO_PRIVATE_API_KEY || !site.klaviyoListId) {
    await db
      .update(buildsellSiteLeads)
      .set({ klaviyoStatus: 'skipped' })
      .where(eq(buildsellSiteLeads.id, lead.id))
      .execute();
    return;
  }

  try {
    const { profileId } = await createOrUpdateProfile({
      email: submitterEmail,
      phone: submitterPhone,
      firstName: lead.name ?? undefined,
      properties: {
        lead_source: lead.source,
        buildsell_site_id: site.id,
        trade: site.trade,
        city: site.city,
        state: site.state,
      },
    });

    await subscribeProfileToList({
      listId: site.klaviyoListId,
      email: submitterEmail,
      phone: submitterPhone,
      consentMethod: `bs-lead-form (${site.trade} ${site.city})`,
    });

    await db
      .update(buildsellSiteLeads)
      .set({ klaviyoStatus: 'sent', klaviyoProfileId: profileId })
      .where(eq(buildsellSiteLeads.id, lead.id))
      .execute();
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : err, leadId: lead.id },
      'bs/lead: forward to klaviyo failed',
    );
    await db
      .update(buildsellSiteLeads)
      .set({ klaviyoStatus: 'failed' })
      .where(eq(buildsellSiteLeads.id, lead.id))
      .execute();
  }
}

function corsResponse(res: NextResponse): NextResponse {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  res.headers.set('Access-Control-Max-Age', '86400');
  return res;
}
