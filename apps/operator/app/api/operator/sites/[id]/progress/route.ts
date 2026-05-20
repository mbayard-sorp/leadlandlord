import { NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, agentRuns, agentEvents, sites } from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';
import { verifySession, sessionCookieName } from '../../../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── Stage definitions ────────────────────────────────────────────────────────
//
// Lifecycle stages in display order, mirroring the real site-builder pipeline.
// Each stage maps to EITHER:
//   - an agent_events.type value (event-sourced stages: niche approval)
//   - an agent_runs.agent name (sub-agent + parent-run stages)
//
// Source-of-truth mapping derived from:
//   - packages/agents/src/operator/index.ts (niche.approved event)
//   - packages/agents/src/site-builder/index.ts (parent run; row created at run
//     start, then keyword-planner → content-engine → Sanity write → success)
//   - packages/agents/src/keyword-planner/index.ts (name: 'keyword-planner')
//   - packages/agents/src/content-engine/index.ts (name: 'content-engine')
//
// NOTE: tracking-number provisioning was removed from the build path (#89 — it's
// assigned manually out of band), so there is no 'tracking' stage. The old
// 'Site built' (site.deployed event) and 'Deployed' (site-builder succeeded)
// stages fired near-simultaneously and are collapsed into a single 'Complete'.

export interface Stage {
  id: string;
  label: string;
  /** How to look up completion — via agent_events.type or agent_runs.agent */
  source: 'event_type' | 'agent_run';
  /** The value to match against event.type or run.agent */
  match: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  startedAt: string | null;
  /** Duration in ms, null if not yet completed. */
  durationMs: number | null;
  /** USD cost, null for event-sourced stages (no cost row). */
  costUsd: number | null;
  error: string | null;
}

export interface ProgressResponse {
  ok: true;
  stages: Stage[];
  /** True when site.status === 'live' AND deployedAt is > 24h ago */
  hideBar: boolean;
}

// Ordered stage definitions (static — no runtime mutation).
const STAGE_DEFS = [
  {
    id: 'niche_approved',
    label: 'Niche approved',
    source: 'event_type' as const,
    match: 'niche.approved',
  },
  {
    id: 'site_created',
    label: 'Site created',
    source: 'agent_run' as const,
    match: 'site-builder',
    // The sites row + Sanity stub are created at the very start of the
    // site-builder run, so any existing run means the site exists — mark done
    // as soon as the run starts rather than waiting for the whole build.
    requireStarted: true,
  },
  {
    id: 'keywords_planned',
    label: 'Keywords planned',
    source: 'agent_run' as const,
    match: 'keyword-planner',
  },
  {
    id: 'content_generated',
    label: 'Content generated',
    source: 'agent_run' as const,
    match: 'content-engine',
  },
  {
    id: 'complete',
    label: 'Complete',
    source: 'agent_run' as const,
    match: 'site-builder',
    // site-builder reaching 'succeeded' = pages published to Sanity + fully
    // finalized. Shows 'running' while the build is in flight.
    requireSucceeded: true,
  },
] as const;

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
    const [siteRows, runRows, eventRows] = await Promise.all([
      db.select({ status: sites.status, deployedAt: sites.deployedAt })
        .from(sites)
        .where(eq(sites.id, siteId))
        .limit(1),
      db.select()
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.siteId, siteId),
            inArray(agentRuns.agent, [
              'site-builder',
              'keyword-planner',
              'content-engine',
            ]),
          ),
        )
        .orderBy(desc(agentRuns.startedAt))
        .limit(20),
      // Fetch niche.approved events — the build trigger. niche.approved carries
      // nicheId (no site_id), so we can't cleanly join to this site here; we
      // accept the most recent one (handled in application code below).
      db.select()
        .from(agentEvents)
        .where(eq(agentEvents.type, 'niche.approved'))
        .orderBy(desc(agentEvents.createdAt))
        .limit(50),
    ]);

    const siteRow = siteRows[0];
    if (!siteRow) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    // Resolve hideBar — live + more than 24h since deployment
    const hideBar =
      siteRow.status === 'live' &&
      siteRow.deployedAt != null &&
      Date.now() - new Date(siteRow.deployedAt).getTime() > 24 * 60 * 60 * 1000;

    // Build a lookup for agent runs by agent name (most recent first, so we
    // get the latest run's status per agent type)
    const latestRunByAgent = new Map<
      string,
      (typeof runRows)[number]
    >();
    for (const run of runRows) {
      if (!latestRunByAgent.has(run.agent)) {
        latestRunByAgent.set(run.agent, run);
      }
    }

    // Build a lookup for event types. For niche.approved we accept the most
    // recent one — closest we can get without the nicheId → site join.
    const eventsByType = new Map<string, (typeof eventRows)[number]>();
    for (const ev of eventRows) {
      if (eventsByType.has(ev.type)) continue;
      if (ev.type === 'niche.approved') {
        eventsByType.set(ev.type, ev);
      }
    }

    // Map stages to status
    const stages: Stage[] = STAGE_DEFS.map((def) => {
      const base: Stage = {
        id: def.id,
        label: def.label,
        source: def.source,
        match: def.match,
        status: 'pending',
        startedAt: null,
        durationMs: null,
        costUsd: null,
        error: null,
      };

      if (def.source === 'event_type') {
        const ev = eventsByType.get(def.match);
        if (!ev) return base;
        // Events don't have a status field; presence = done, unless dead-lettered
        if (ev.deadLetteredAt) {
          return { ...base, status: 'failed', startedAt: ev.createdAt.toISOString(), error: ev.error ?? 'dead-lettered' };
        }
        return { ...base, status: 'done', startedAt: ev.createdAt.toISOString() };
      }

      // agent_run source
      const run = latestRunByAgent.get(def.match);
      if (!run) return base;

      // Special case: 'site_created' is done as soon as the site-builder run
      // exists (the row + Sanity stub are written first thing), regardless of
      // whether the overall build later succeeds or fails.
      if ('requireStarted' in def && def.requireStarted) {
        return { ...base, status: 'done', startedAt: run.startedAt.toISOString() };
      }

      // Special case: 'complete' stage uses site-builder but only when succeeded
      if ('requireSucceeded' in def && def.requireSucceeded) {
        if (run.status === 'succeeded') {
          const startMs = run.startedAt.getTime();
          const endMs = run.endedAt ? run.endedAt.getTime() : Date.now();
          return {
            ...base,
            status: 'done',
            startedAt: run.startedAt.toISOString(),
            durationMs: endMs - startMs,
            costUsd: Number(run.costUsd ?? 0),
          };
        }
        // If site-builder is still running, mark as running
        if (run.status === 'running') {
          return {
            ...base,
            status: 'running',
            startedAt: run.startedAt.toISOString(),
            costUsd: Number(run.costUsd ?? 0),
          };
        }
        return base;
      }

      const startMs = run.startedAt.getTime();
      const endMs = run.endedAt ? run.endedAt.getTime() : Date.now();

      switch (run.status) {
        case 'succeeded':
          return {
            ...base,
            status: 'done',
            startedAt: run.startedAt.toISOString(),
            durationMs: endMs - startMs,
            costUsd: Number(run.costUsd ?? 0),
          };
        case 'running':
          return {
            ...base,
            status: 'running',
            startedAt: run.startedAt.toISOString(),
            costUsd: Number(run.costUsd ?? 0),
          };
        case 'failed':
        case 'budget_exceeded':
          return {
            ...base,
            status: 'failed',
            startedAt: run.startedAt.toISOString(),
            durationMs: endMs - startMs,
            costUsd: Number(run.costUsd ?? 0),
            error: run.error ?? run.status,
          };
        default:
          return base;
      }
    });

    const body: ProgressResponse = { ok: true, stages, hideBar };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error(
      { siteId, err: err instanceof Error ? err.message : String(err) },
      'progress route query failed',
    );
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });
  }
}

export type { Stage as ProgressStage };
