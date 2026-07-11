import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, calls } from '@leadlandlord/db';
import { verifyRecordingToken } from '@leadlandlord/shared/tenant-recording-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Streams a call recording for tenants, gated by a signed `?t=` token
 * instead of an operator session (tenants read their qualified-lead email
 * days later — see lib/tenant-lead-notify.ts, ADR 0031 Phase D). Otherwise
 * mirrors apps/operator/app/api/operator/calls/[id]/recording/route.ts:
 * fetches the Twilio-protected recording URL server-side with Basic Auth so
 * the tenant's browser never sees Twilio credentials, and forwards Range for
 * seeking.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ callId: string }> },
) {
  const { callId } = await params;

  const url = new URL(req.url);
  const token = url.searchParams.get('t');
  const secret = process.env.TENANT_RECORDING_SECRET || process.env.OPERATOR_SESSION_SECRET;
  if (!verifyRecordingToken(callId, token, secret)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const db = getDb();
  const row = (
    await db.select({ recordingUrl: calls.recordingUrl }).from(calls).where(eq(calls.id, callId)).limit(1)
  )[0];

  if (!row?.recordingUrl) {
    return NextResponse.json({ ok: false, error: 'no recording' }, { status: 404 });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !authToken) {
    return NextResponse.json({ ok: false, error: 'twilio credentials not configured' }, { status: 500 });
  }

  const auth = Buffer.from(`${sid}:${authToken}`).toString('base64');
  const range = req.headers.get('range');
  const upstream = await fetch(row.recordingUrl, {
    headers: {
      Authorization: `Basic ${auth}`,
      ...(range ? { Range: range } : {}),
    },
  });

  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json(
      { ok: false, error: `twilio responded ${upstream.status}` },
      { status: 502 },
    );
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('content-type') ?? 'audio/mpeg');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'private, max-age=3600');
  const len = upstream.headers.get('content-length');
  if (len) headers.set('Content-Length', len);
  const contentRange = upstream.headers.get('content-range');
  if (contentRange) headers.set('Content-Range', contentRange);

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
