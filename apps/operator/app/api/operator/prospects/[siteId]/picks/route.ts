import { NextResponse } from 'next/server';
import { and, desc, eq, or } from 'drizzle-orm';
import { getDb, backlinkProspects } from '@leadlandlord/db';
import { verifySession, sessionCookieName } from '../../../../../../lib/auth';
import { log } from '@leadlandlord/shared/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ siteId: string }> },
): Promise<Response> {
  const cookies = req.headers.get('cookie') ?? '';
  const cookieName = sessionCookieName();
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
  if (!verifySession(match?.[1])) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { siteId } = await params;
  const db = getDb();

  try {
    const rows = await db
      .select()
      .from(backlinkProspects)
      .where(
        and(
          eq(backlinkProspects.siteId, siteId),
          or(
            eq(backlinkProspects.status, 'flagged_top5'),
            eq(backlinkProspects.status, 'approved'),
          ),
        ),
      )
      .orderBy(desc(backlinkProspects.score))
      .limit(50);

    return NextResponse.json(
      { ok: true, siteId, rows },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    log.error(
      { siteId, err: err instanceof Error ? err.message : String(err) },
      'prospects/picks query failed',
    );
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });
  }
}
