import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { getDb, sites, leads, type Lead, type Site } from '@leadlandlord/db';
import { sendSms } from '@leadlandlord/integrations/twilio';
import { sendEmail } from '@leadlandlord/integrations/resend';
import { createOrUpdateProfile, subscribeProfileToList } from '@leadlandlord/integrations/klaviyo';
import { log } from '@leadlandlord/shared/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public lead-form endpoint. Tenant sites POST here from their static-export
 * lead forms — possibly cross-origin if the site is on a custom domain. The
 * shape matches LeadForm.tsx in the site-template package.
 *
 * Pipeline:
 *   1. Validate + write the lead row (always — even if every external call fails)
 *   2. Best-effort fan-out via after():
 *      - Klaviyo profile upsert + subscribe to the site's list
 *      - SMS to operator phone
 *      - Email to operator inbox
 *
 * Returns 200 fast; observability via the lead row's *_status columns.
 */

const Body = z.object({
  /** Site slug or UUID — looked up to pin the lead to a site row. */
  site_id: z.string().min(1).optional(),
  site_slug: z.string().min(1).optional(),
  name: z.string().max(120).optional(),
  phone: z.string().max(40),
  email: z.string().email().max(160).optional(),
  zip: z.string().max(16).optional(),
  message: z.string().max(2000).optional(),
  source: z.string().max(40).default('home'),
  /** Honeypot field — non-empty means a bot. */
  website: z.string().optional(),
});

export async function OPTIONS() {
  return corsResponse(new NextResponse(null, { status: 204 }));
}

export async function POST(req: Request) {
  let payload: z.infer<typeof Body>;
  try {
    payload = Body.parse(await req.json());
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'invalid lead payload');
    return corsResponse(NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 }));
  }

  // Honeypot tripped — quietly succeed without writing anything.
  if (payload.website && payload.website.trim().length > 0) {
    return corsResponse(NextResponse.json({ ok: true }));
  }

  const db = getDb();
  const site = await resolveSite(payload);

  if (!site) {
    log.warn({ payload }, 'lead submission with no resolvable site');
    return corsResponse(
      NextResponse.json({ ok: false, error: 'site_not_found' }, { status: 404 }),
    );
  }

  // Pull request metadata that's useful for triage.
  const ua = req.headers.get('user-agent') ?? undefined;
  const referer = req.headers.get('referer') ?? undefined;
  const url = new URL(req.url);
  const utm: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (k.startsWith('utm_')) utm[k] = v;
  }

  const inserted = (
    await db
      .insert(leads)
      .values({
        siteId: site.id,
        name: payload.name,
        phone: payload.phone,
        email: payload.email,
        zip: payload.zip,
        message: payload.message,
        source: payload.source,
        smsStatus: 'pending',
        emailStatus: 'pending',
        metadata: { user_agent: ua, referer, ...(Object.keys(utm).length ? { utm } : {}) },
      })
      .returning()
  )[0];
  if (!inserted) {
    log.error({ siteId: site.id }, 'lead insert returned no rows');
    return corsResponse(NextResponse.json({ ok: false, error: 'insert_failed' }, { status: 500 }));
  }

  log.info({ leadId: inserted.id, siteId: site.id }, 'lead captured');

  // Fan out notifications without blocking the response.
  after(() => fanOut(inserted, site));

  return corsResponse(NextResponse.json({ ok: true, lead_id: inserted.id }));
}

async function resolveSite(payload: z.infer<typeof Body>): Promise<Site | null> {
  const db = getDb();
  if (payload.site_id) {
    const rows = await db.select().from(sites).where(eq(sites.id, payload.site_id)).limit(1);
    if (rows[0]) return rows[0];
  }
  if (payload.site_slug) {
    // Match against vercel project name — Site Builder slugs niche-city.
    const rows = await db
      .select()
      .from(sites)
      .where(eq(sites.vercelProjectName, payload.site_slug))
      .limit(1);
    if (rows[0]) return rows[0];
  }
  // Fallback: if there's exactly one live site, attribute to it. Useful for
  // dev where the form omits site_id and the operator has just one site.
  const all = await db.select().from(sites).limit(2);
  if (all.length === 1 && all[0]) return all[0];
  return null;
}

/**
 * Best-effort downstream calls. Each branch updates its column on the lead row
 * so the operator dashboard can surface failed deliveries.
 */
async function fanOut(lead: Lead, site: Site): Promise<void> {
  const db = getDb();

  await Promise.allSettled([
    notifyOperatorSms(lead, site).then(
      (status) =>
        db.update(leads).set({ smsStatus: status }).where(eq(leads.id, lead.id)).execute(),
      (err) => {
        log.error({ err: err instanceof Error ? err.message : err, leadId: lead.id }, 'sms fan-out crashed');
        return db.update(leads).set({ smsStatus: 'failed' }).where(eq(leads.id, lead.id)).execute();
      },
    ),
    notifyOperatorEmail(lead, site).then(
      (status) =>
        db.update(leads).set({ emailStatus: status }).where(eq(leads.id, lead.id)).execute(),
      (err) => {
        log.error({ err: err instanceof Error ? err.message : err, leadId: lead.id }, 'email fan-out crashed');
        return db.update(leads).set({ emailStatus: 'failed' }).where(eq(leads.id, lead.id)).execute();
      },
    ),
    upsertKlaviyo(lead, site).then(
      (profileId) => {
        if (profileId) {
          return db
            .update(leads)
            .set({ klaviyoProfileId: profileId })
            .where(eq(leads.id, lead.id))
            .execute();
        }
        return undefined;
      },
      (err) => {
        log.error(
          { err: err instanceof Error ? err.message : err, leadId: lead.id },
          'klaviyo fan-out crashed',
        );
        return undefined;
      },
    ),
  ]);
}

async function notifyOperatorSms(lead: Lead, site: Site): Promise<string> {
  const to = process.env.OPERATOR_PHONE_NUMBER;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!to || !from || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return 'skipped';
  }
  const summary = `New lead — ${site.niche} ${site.city}\n${lead.name ?? '(no name)'} · ${lead.phone}${lead.zip ? ` · ${lead.zip}` : ''}${lead.message ? `\n"${truncate(lead.message, 120)}"` : ''}`;
  await sendSms({ to, from, body: summary });
  return 'sent';
}

async function notifyOperatorEmail(lead: Lead, site: Site): Promise<string> {
  const to = process.env.OPERATOR_EMAIL;
  const from = process.env.RESEND_FROM_ADDRESS;
  if (!to || !from || !process.env.RESEND_API_KEY) {
    return 'skipped';
  }
  const subject = `New lead — ${site.niche} in ${site.city}, ${site.state}`;
  const lines = [
    `Site: ${site.niche} · ${site.city}, ${site.state}`,
    `Source: ${lead.source}`,
    '',
    `Name: ${lead.name ?? '—'}`,
    `Phone: ${lead.phone}`,
    `Email: ${lead.email ?? '—'}`,
    `ZIP: ${lead.zip ?? '—'}`,
    '',
    'Message:',
    lead.message ?? '(none)',
  ];
  await sendEmail({ to, from, subject, text: lines.join('\n') });
  return 'sent';
}

async function upsertKlaviyo(lead: Lead, site: Site): Promise<string | null> {
  if (!process.env.KLAVIYO_PRIVATE_API_KEY) return null;
  if (!lead.email && !lead.phone) return null;
  const { profileId } = await createOrUpdateProfile({
    email: lead.email ?? undefined,
    phone: lead.phone ?? undefined,
    firstName: lead.name?.split(' ')[0],
    lastName: lead.name?.split(' ').slice(1).join(' ') || undefined,
    zip: lead.zip ?? undefined,
    properties: {
      lead_source: lead.source,
      site_id: site.id,
      niche: site.niche,
      city: site.city,
      state: site.state,
    },
  });
  if (site.klaviyoListId) {
    try {
      await subscribeProfileToList({
        listId: site.klaviyoListId,
        email: lead.email ?? undefined,
        phone: lead.phone ?? undefined,
        consentMethod: `lead-form (${site.niche} ${site.city})`,
      });
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : err, listId: site.klaviyoListId },
        'klaviyo subscribe failed (profile still upserted)',
      );
    }
  }
  return profileId;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

function corsResponse(res: NextResponse): NextResponse {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  res.headers.set('Access-Control-Max-Age', '86400');
  return res;
}
