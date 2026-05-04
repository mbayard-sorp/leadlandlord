import { NextResponse } from 'next/server';
import { addSuppression, removeSuppression } from '@leadlandlord/db/suppression';
import { log } from '@leadlandlord/shared/log';
import { readTwilioParams, verifyTwilioRequest } from '../../../../../lib/twilio-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Inbound SMS webhook — Twilio fires this when someone texts our outbound
 * number (the one Outreach Agent sent FROM). We use it to:
 *
 *   - STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT → add to suppression
 *   - START / UNSTOP / YES → remove from suppression (re-opt-in)
 *   - HELP / INFO → return a help reply
 *   - anything else → log it as a reply event for the operator dashboard
 *
 * Twilio handles the auto-acknowledgement TwiML for STOP/UNSTOP/HELP at the
 * platform level when "Advanced Opt-Out" is enabled — we just need to update
 * our own suppression list so subsequent outreach via Compliance Guard
 * blocks correctly. We return empty TwiML to avoid double-replying.
 *
 * Configure Twilio: Console → Phone Numbers → your outbound number →
 * Messaging Configuration → A MESSAGE COMES IN → Webhook →
 * `https://leadlandlord-operator.vercel.app/api/webhooks/twilio/sms`
 */

const STOP_KEYWORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'remove', 'opt out'];
const RESUME_KEYWORDS = ['start', 'unstop', 'yes', 'opt in'];
const HELP_KEYWORDS = ['help', 'info'];

export async function POST(req: Request) {
  const fields = await readTwilioParams(req);
  if (!(await verifyTwilioRequest(req, fields))) {
    log.warn({ from: fields.From }, 'twilio sms signature mismatch');
    return new NextResponse('forbidden', { status: 403 });
  }

  const from = fields.From;
  const to = fields.To;
  const body = (fields.Body ?? '').trim();
  const lower = body.toLowerCase();

  if (!from) {
    return NextResponse.json({ ok: false, error: 'no_from' }, { status: 400 });
  }

  if (STOP_KEYWORDS.some((k) => exactKeyword(lower, k))) {
    await addSuppression({
      identifier: from,
      type: 'phone',
      reason: 'sms_stop',
      channel: 'sms',
      metadata: { keyword: lower, to_number: to },
    });
    log.info({ from }, 'sms STOP — suppressed');
    return twimlResponse(); // Twilio sends its own auto-reply
  }

  if (RESUME_KEYWORDS.some((k) => exactKeyword(lower, k))) {
    const removed = await removeSuppression(from, 'phone');
    log.info({ from, removed }, 'sms START — un-suppressed');
    return twimlResponse();
  }

  if (HELP_KEYWORDS.some((k) => exactKeyword(lower, k))) {
    log.info({ from }, 'sms HELP request');
    return twimlResponse(
      'LeadLandlord: We forward calls to local businesses. Reply STOP to opt out.',
    );
  }

  // Anything else — likely a "YES" reply to an outreach SMS, or a question.
  // Log it for the operator dashboard. (Phase 6.4+: wire this into the
  // Trial Manager when we detect a positive reply.)
  log.info({ from, body: body.slice(0, 200) }, 'sms inbound — non-keyword reply');
  return twimlResponse();
}

/** Exact-keyword match: the body equals or starts with the keyword (allowing trailing punctuation). */
function exactKeyword(body: string, keyword: string): boolean {
  if (body === keyword) return true;
  return body.startsWith(`${keyword} `) || body.startsWith(`${keyword}.`) || body.startsWith(`${keyword}!`);
}

function twimlResponse(message?: string): NextResponse {
  const twiml = message
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`;
  return new NextResponse(twiml, {
    status: 200,
    headers: { 'content-type': 'text/xml' },
  });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
