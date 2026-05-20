import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, calls } from '@leadlandlord/db';
import { requireOperatorSession } from '../../../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Streams a call recording from Twilio through the operator app so the
 * browser never sees Twilio's Basic Auth credentials. The stored
 * `calls.recordingUrl` points at Twilio's protected media endpoint
 * (api.twilio.com/.../Recordings/{Sid}.mp3) which 401s an unauthenticated
 * <audio> request. We fetch it server-side with the account creds and pipe
 * the bytes back. The Range header is forwarded so seeking works.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireOperatorSession();
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();
  const row = (
    await db.select({ recordingUrl: calls.recordingUrl }).from(calls).where(eq(calls.id, id)).limit(1)
  )[0];

  if (!row?.recordingUrl) {
    return NextResponse.json({ ok: false, error: 'no recording' }, { status: 404 });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    return NextResponse.json({ ok: false, error: 'twilio credentials not configured' }, { status: 500 });
  }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
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
