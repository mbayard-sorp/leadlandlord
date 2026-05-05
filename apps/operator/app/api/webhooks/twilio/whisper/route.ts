import { NextResponse } from 'next/server';
import { buildWhisperTwiml } from '@leadlandlord/integrations/twilio';
import { readTwilioParams, verifyTwilioRequest } from '../../../../../lib/twilio-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Whisper webhook — TwiML returned to the answering party (operator or tenant)
 * before they're connected to the caller. Reads the message from the `?msg=`
 * query string set by the voice webhook.
 */
export async function POST(req: Request) {
  const params = await readTwilioParams(req);
  if (!(await verifyTwilioRequest(req, params))) {
    return new NextResponse('forbidden', { status: 403 });
  }
  const url = new URL(req.url);
  const msg = url.searchParams.get('msg') ?? 'Call from LeadLandlord.';
  return new NextResponse(buildWhisperTwiml(msg), {
    status: 200,
    headers: { 'content-type': 'text/xml' },
  });
}
