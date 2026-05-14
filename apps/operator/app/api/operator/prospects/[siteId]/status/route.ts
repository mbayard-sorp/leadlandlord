import { NextResponse } from 'next/server';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { getDb, agentRuns, agentEvents, backlinks, backlinkProspects, sites } from '@leadlandlord/db';
import { verifySession, sessionCookieName } from '../../../../../../lib/auth';
import { log } from '@leadlandlord/shared/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RunStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'budget_exceeded';

function mapStatus(s: string): RunStatus {
  if (s === 'running') return 'running';
  if (s === 'succeeded') return 'succeeded';
  if (s === 'failed') return 'failed';
  if (s === 'budget_exceeded') return 'budget_exceeded';
  return 'idle';
}

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
    const [siteRow, builderRuns, scorerRuns, prospectRows, prospectCounts, triageRows, pendingEvents] =
      await Promise.all([
        db
          .select({ competitorSeeds: sites.competitorSeeds })
          .from(sites)
          .where(eq(sites.id, siteId))
          .limit(1),
        db
          .select()
          .from(agentRuns)
          .where(and(eq(agentRuns.siteId, siteId), eq(agentRuns.agent, 'backlink-builder')))
          .orderBy(desc(agentRuns.startedAt))
          .limit(5),
        db
          .select()
          .from(agentRuns)
          .where(and(eq(agentRuns.siteId, siteId), eq(agentRuns.agent, 'molly-scorer')))
          .orderBy(desc(agentRuns.startedAt))
          .limit(5),
        db
          .select()
          .from(backlinks)
          .where(and(eq(backlinks.siteId, siteId), eq(backlinks.type, 'guest_post')))
          .orderBy(desc(backlinks.createdAt))
          .limit(100),
        db
          .select({ id: backlinkProspects.id, status: backlinkProspects.status })
          .from(backlinkProspects)
          .where(
            and(
              eq(backlinkProspects.siteId, siteId),
              or(
                eq(backlinkProspects.status, 'flagged_top5'),
                eq(backlinkProspects.status, 'approved'),
              ),
            ),
          ),
        db
          .select()
          .from(backlinkProspects)
          .where(eq(backlinkProspects.siteId, siteId))
          .orderBy(desc(backlinkProspects.createdAt))
          .limit(200),
        db
          .select({ id: agentEvents.id, payload: agentEvents.payload })
          .from(agentEvents)
          .where(
            and(
              eq(agentEvents.type, 'operator.prospect.requested'),
              isNull(agentEvents.processedAt),
              isNull(agentEvents.deadLetteredAt),
            ),
          )
          .limit(50),
      ]);

    const hasUnprocessedEvent = pendingEvents.some((ev) => {
      const p = ev.payload as Record<string, unknown>;
      return p?.siteId === siteId;
    });

    const latestBuilder = builderRuns[0];
    const latestScorer = scorerRuns[0];

    const prospectRunStatus: RunStatus = latestBuilder
      ? mapStatus(latestBuilder.status)
      : 'idle';

    const mollyRunStatus: RunStatus = latestScorer
      ? mapStatus(latestScorer.status)
      : 'idle';

    const builderOutput =
      latestBuilder?.status === 'succeeded' && latestBuilder.output
        ? (latestBuilder.output as Record<string, unknown>)
        : null;

    const runRows = prospectRows.filter((r) => {
      const md = (r.metadata ?? {}) as Record<string, unknown>;
      const p = md.prospect as Record<string, unknown> | undefined;
      return p?.run === true;
    });

    const top5Count = prospectCounts.filter((p) => p.status === 'flagged_top5').length;
    const pendingApprovalCount = prospectCounts.filter((p) => p.status === 'approved').length;

    const runningOrQueued =
      hasUnprocessedEvent || latestBuilder?.status === 'running';

    const body = {
      ok: true,
      siteId,
      competitorSeeds: siteRow[0]?.competitorSeeds ?? [],
      runningOrQueued,
      prospectRun: {
        status: prospectRunStatus,
        progressMessage: latestBuilder?.progressMessage ?? null,
        progressStep: latestBuilder?.progressStep ?? null,
        progressTotal: latestBuilder?.progressTotal ?? null,
        lastRunAt: latestBuilder?.endedAt?.toISOString() ?? null,
        discovered:
          typeof builderOutput?.prospectsDiscovered === 'number'
            ? builderOutput.prospectsDiscovered
            : null,
        enriched:
          typeof builderOutput?.prospectsEnriched === 'number'
            ? builderOutput.prospectsEnriched
            : null,
        created:
          typeof builderOutput?.rowsCreated === 'number' ? builderOutput.rowsCreated : null,
        error: latestBuilder?.error ?? null,
      },
      mollyRun: {
        status: mollyRunStatus,
        progressMessage: latestScorer?.progressMessage ?? null,
        lastRunAt: latestScorer?.endedAt?.toISOString() ?? null,
        top5Count,
        pendingApprovalCount,
        error: latestScorer?.error ?? null,
      },
      prospects: {
        rows: runRows,
      },
      triage: {
        rows: triageRows,
      },
    };

    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error(
      { siteId, err: err instanceof Error ? err.message : String(err) },
      'prospects/status query failed',
    );
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });
  }
}
