import { sql, desc } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import { getDb, agentRuns, agentEvents, type AgentRun, type AgentEvent } from '@leadlandlord/db';

export const revalidate = 30;

interface DailyAgentStats {
  agent: string;
  runs: number;
  cost: number;
  tokens_in: number;
  tokens_out: number;
}

const loadRecentRuns = unstable_cache(
  async (): Promise<AgentRun[]> => {
    const db = getDb();
    return await db.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(50);
  },
  ['operator-recent-runs'],
  { revalidate: 30, tags: ['agent-runs'] },
);

const loadTodayStats = unstable_cache(
  async (): Promise<DailyAgentStats[]> => {
    const db = getDb();
    const result = await db.execute(sql`
      SELECT agent,
             COUNT(*)::int AS runs,
             COALESCE(SUM(cost_usd), 0)::float AS cost,
             COALESCE(SUM(tokens_in), 0)::int AS tokens_in,
             COALESCE(SUM(tokens_out), 0)::int AS tokens_out
        FROM agent_runs
       WHERE started_at >= CURRENT_DATE
       GROUP BY agent
       ORDER BY cost DESC
    `);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (Array.isArray(result) ? result : (result as any).rows) as DailyAgentStats[];
  },
  ['operator-today-stats'],
  { revalidate: 30, tags: ['agent-runs'] },
);

const loadApprovalQueue = unstable_cache(
  async (): Promise<AgentEvent[]> => {
    const db = getDb();
    return await db
      .select()
      .from(agentEvents)
      .where(sql`${agentEvents.requiresApproval} = true AND ${agentEvents.processedAt} IS NULL`)
      .limit(50);
  },
  ['operator-approval-queue'],
  { revalidate: 30, tags: ['approval-queue'] },
);

export default async function AgentsPage() {
  const [recentRuns, todayByAgent, approvalQueue] = await Promise.all([
    loadRecentRuns(),
    loadTodayStats(),
    loadApprovalQueue(),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Agents</h1>
        <p className="text-sm text-slate-400 mt-1">
          Live runs, today's cost-by-agent, and pending manual approvals.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">Today</h2>
        {todayByAgent.length === 0 ? (
          <p className="text-sm text-slate-500">No runs yet today.</p>
        ) : (
          <div className="rounded-lg border border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Agent</th>
                  <th className="text-left px-3 py-2">Runs</th>
                  <th className="text-left px-3 py-2">Tokens in/out</th>
                  <th className="text-left px-3 py-2">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {todayByAgent.map((r) => (
                  <tr key={r.agent}>
                    <td className="px-3 py-2 font-mono">{r.agent}</td>
                    <td className="px-3 py-2">{r.runs}</td>
                    <td className="px-3 py-2 text-slate-400">
                      {r.tokens_in.toLocaleString()} / {r.tokens_out.toLocaleString()}
                    </td>
                    <td className="px-3 py-2">${r.cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">
          Approval queue ({approvalQueue.length})
        </h2>
        {approvalQueue.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing awaiting human approval.</p>
        ) : (
          <ul className="space-y-2">
            {approvalQueue.map((e) => (
              <li
                key={e.id}
                className="rounded border border-amber-700/40 bg-amber-900/10 p-3 text-sm"
              >
                <div className="flex justify-between text-xs text-amber-300 uppercase tracking-wide">
                  <span>{e.targetAgent ?? e.agent}</span>
                  <span>{new Date(e.createdAt).toLocaleString()}</span>
                </div>
                <pre className="mt-2 text-xs text-slate-300 overflow-x-auto">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">Recent runs</h2>
        <div className="rounded-lg border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Agent</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Started</th>
                <th className="text-left px-3 py-2">Duration</th>
                <th className="text-left px-3 py-2">Tokens</th>
                <th className="text-left px-3 py-2">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {recentRuns.map((r) => {
                const dur =
                  r.endedAt && r.startedAt
                    ? `${((r.endedAt.getTime() - r.startedAt.getTime()) / 1000).toFixed(1)}s`
                    : '…';
                return (
                  <tr key={r.id} className="hover:bg-slate-900/40">
                    <td className="px-3 py-2 font-mono">{r.agent}</td>
                    <td className="px-3 py-2">
                      <RunStatus status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      {r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-400">{dur}</td>
                    <td className="px-3 py-2 text-slate-400">
                      {r.tokensIn.toLocaleString()} / {r.tokensOut.toLocaleString()}
                    </td>
                    <td className="px-3 py-2">${Number(r.costUsd).toFixed(4)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function RunStatus({ status }: { status: string }) {
  const tone =
    status === 'succeeded'
      ? 'text-emerald-300'
      : status === 'running'
      ? 'text-sky-300'
      : status === 'budget_exceeded'
      ? 'text-amber-300'
      : status === 'not_implemented'
      ? 'text-slate-500'
      : 'text-red-300';
  return <span className={tone}>{status}</span>;
}
