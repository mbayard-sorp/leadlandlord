import { NextResponse } from 'next/server';
import { getDb, sites } from '@leadlandlord/db';
import { verifySession, sessionCookieName } from '../../../../../lib/auth';
import { log } from '@leadlandlord/shared/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const cookies = req.headers.get('cookie') ?? '';
  const cookieName = sessionCookieName();
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
  if (!verifySession(match?.[1])) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const db = getDb();
  try {
    const rows = await db
      .select({
        id: sites.id,
        niche: sites.niche,
        city: sites.city,
        state: sites.state,
        competitorSeeds: sites.competitorSeeds,
      })
      .from(sites)
      .limit(500);

    const body = rows.map((r) => ({
      id: r.id,
      label: `${r.niche} — ${r.city}, ${r.state}`,
      hasCompetitorSeeds: Array.isArray(r.competitorSeeds) && r.competitorSeeds.length > 0,
    }));

    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'prospects/sites query failed');
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });
  }
}
