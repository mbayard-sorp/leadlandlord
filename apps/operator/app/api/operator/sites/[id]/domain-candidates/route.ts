import { NextResponse } from 'next/server';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  getDb,
  agentEvents,
  agentRuns,
  domainCandidates,
  type DomainCandidate,
} from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';
import { verifySession, sessionCookieName } from '../../../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DomainCandidateRow {
  id: string;
  domain: string;
  rank: number | null;
  matchType: string | null;
  priceUsd: string | null;
  registrar: string;
  status: DomainCandidate['status'];
}

interface DomainCandidatesResponse {
  ok: true;
  searching: boolean;
  candidates: DomainCandidateRow[];
}

/**
 * Domain candidates feed for the site detail panel — polled while a search
 * is in flight so the UI updates as the Domain Procurer writes rows.
 *
 * `searching` is true when there is either:
 *   - an unprocessed `domain-procurer` event whose payload references this site, or
 *   - a `domain-procurer` agent run for this site with status `running`.
 *
 * The panel uses `searching` to (a) keep the spinner visible and (b) decide
 * when to stop polling.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const cookies = req.headers.get('cookie') ?? '';
  const cookieName = sessionCookieName();
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
  if (!verifySession(match?.[1])) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { id: siteId } = await params;
  const db = getDb();

  try {
    const [candidates, pendingEvents, runningRuns] = await Promise.all([
      db
        .select()
        .from(domainCandidates)
        .where(
          and(
            eq(domainCandidates.siteId, siteId),
            inArray(domainCandidates.status, ['available', 'pending_approval']),
          ),
        )
        .orderBy(asc(domainCandidates.rank))
        .limit(50),
      db
        .select({ id: agentEvents.id })
        .from(agentEvents)
        .where(
          and(
            eq(agentEvents.targetAgent, 'domain-procurer'),
            isNull(agentEvents.processedAt),
            isNull(agentEvents.deadLetteredAt),
            sql`${agentEvents.payload}->>'siteId' = ${siteId}`,
          ),
        )
        .limit(1),
      db
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.agent, 'domain-procurer'),
            eq(agentRuns.siteId, siteId),
            eq(agentRuns.status, 'running'),
          ),
        )
        .limit(1),
    ]);

    const body: DomainCandidatesResponse = {
      ok: true,
      searching: pendingEvents.length > 0 || runningRuns.length > 0,
      candidates: candidates.map((c) => ({
        id: c.id,
        domain: c.domain,
        rank: c.rank,
        matchType: c.matchType,
        priceUsd: c.priceUsd != null ? String(c.priceUsd) : null,
        registrar: c.registrar,
        status: c.status,
      })),
    };

    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error(
      { siteId, err: err instanceof Error ? err.message : String(err) },
      'domain candidates feed failed',
    );
    return NextResponse.json(
      { ok: false, error: 'domain_candidates_query_failed' },
      { status: 500 },
    );
  }
}

export type { DomainCandidateRow, DomainCandidatesResponse };
