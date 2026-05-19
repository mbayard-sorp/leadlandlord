import { NextResponse } from 'next/server';
import { desc, gte, or, eq, inArray } from 'drizzle-orm';
import { getDb, agentRuns } from '@leadlandlord/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Diagnostic endpoint for monitoring site-builder cascades. Returns recent
 * site-builder runs + any descendant runs spawned in the last 15 minutes.
 * Use to spot runaway token / cost growth in real time.
 *
 * Not behind auth — read-only diagnostics. Move behind requireOperatorSession
 * if it ever exposes payloads.
 */
export async function GET() {
  const db = getDb();
  const since = new Date(Date.now() - 15 * 60 * 1000);

  // Top-level site-builder runs in the window.
  const parents = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.agent, 'site-builder'))
    .orderBy(desc(agentRuns.startedAt))
    .limit(10);

  const parentIds = parents.map((r) => r.id);

  // Any descendant runs (direct children by parentRunId).
  const children =
    parentIds.length > 0
      ? await db
          .select()
          .from(agentRuns)
          .where(
            or(
              inArray(agentRuns.parentRunId, parentIds),
              gte(agentRuns.startedAt, since),
            ),
          )
          .orderBy(desc(agentRuns.startedAt))
      : [];

  // Aggregate cost + tokens across each parent + its descendants.
  const summary = parents.map((p) => {
    const descendants = children.filter((c) => c.parentRunId === p.id);
    const totalCost =
      Number(p.costUsd) + descendants.reduce((s, c) => s + Number(c.costUsd), 0);
    const totalTokensIn = p.tokensIn + descendants.reduce((s, c) => s + c.tokensIn, 0);
    const totalTokensOut = p.tokensOut + descendants.reduce((s, c) => s + c.tokensOut, 0);
    return {
      runId: p.id,
      status: p.status,
      startedAt: p.startedAt,
      endedAt: p.endedAt,
      progress: {
        step: p.progressStep,
        total: p.progressTotal,
        message: p.progressMessage,
      },
      cost: { self: Number(p.costUsd), total: totalCost },
      tokens: { in: totalTokensIn, out: totalTokensOut },
      descendants: descendants.map((c) => ({
        agent: c.agent,
        status: c.status,
        costUsd: Number(c.costUsd),
        tokensIn: c.tokensIn,
        tokensOut: c.tokensOut,
      })),
      descendantCount: descendants.length,
      error: p.error,
    };
  });

  return NextResponse.json({
    now: new Date().toISOString(),
    runs: summary,
  });
}
