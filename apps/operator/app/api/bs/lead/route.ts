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
import { log } from '@leadlandlord/shared/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  after(() => forwardToOwner(inserted, site, payload.email));

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

function corsResponse(res: NextResponse): NextResponse {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  res.headers.set('Access-Control-Max-Age', '86400');
  return res;
}
