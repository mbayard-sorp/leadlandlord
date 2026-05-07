import { NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, agentRuns, type AgentRun } from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';
import { verifySession, sessionCookieName } from '../../../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ActivityRun {
  id: string;
  agent: string;
  status: AgentRun['status'];
  startedAt: string;
  endedAt: string | null;
  costUsd: number;
  parentRunId: string | null;
  progressMessage: string | null;
  progressStep: number | null;
  progressTotal: number | null;
  progressUpdatedAt: string | null;
  error: string | null;
}

interface ActivityResponse {
  ok: true;
  inflight: ActivityRun[];
  recent: ActivityRun[];
}

const HISTORY_LIMIT = 10;

/**
 * Activity feed for the site detail panel — polled at ~4s.
 *
 * Every agent run (site-builder + its children: keyword-planner, content-
 * engine, tracking-setup) is invoked with `{ siteId }` so all rows scoped to a
 * given site come back in a single indexed query.
 *
 * Auth: same operator session cookie as the rest of the dashboard.
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
    const [inflightRows, recentRows] = await Promise.all([
      db
        .select()
        .from(agentRuns)
        .where(and(eq(agentRuns.siteId, siteId), eq(agentRuns.status, 'running')))
        .orderBy(desc(agentRuns.startedAt)),
      db
        .select()
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.siteId, siteId),
            inArray(agentRuns.status, ['succeeded', 'failed', 'budget_exceeded', 'not_implemented']),
          ),
        )
        .orderBy(desc(agentRuns.startedAt))
        .limit(HISTORY_LIMIT),
    ]);

    const body: ActivityResponse = {
      ok: true,
      inflight: inflightRows.map(toActivityRun),
      recent: recentRows.map(toActivityRun),
    };

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    log.error(
      { siteId, err: err instanceof Error ? err.message : String(err) },
      'activity feed query failed',
    );
    return NextResponse.json(
      { ok: false, error: 'activity_query_failed' },
      { status: 500 },
    );
  }
}

function toActivityRun(r: AgentRun): ActivityRun {
  return {
    id: r.id,
    agent: r.agent,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    costUsd: Number(r.costUsd ?? 0),
    parentRunId: r.parentRunId,
    progressMessage: r.progressMessage,
    progressStep: r.progressStep,
    progressTotal: r.progressTotal,
    progressUpdatedAt: r.progressUpdatedAt ? r.progressUpdatedAt.toISOString() : null,
    error: r.error,
  };
}

export type { ActivityRun, ActivityResponse };
