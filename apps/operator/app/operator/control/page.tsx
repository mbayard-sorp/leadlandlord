import { desc, eq, and } from 'drizzle-orm';
import { getDb, agentRuns, getSystemState, type AgentRun } from '@leadlandlord/db';
import { ControlForms } from './ControlForms';
import { Timestamp } from '../../../components/Timestamp';

export const revalidate = 15;
export const dynamic = 'force-dynamic';

interface FlatDecision {
  runId: string;
  startedAt: Date;
  type: string;
  target: string;
  rationale: string;
  eventEmitted: string | null;
}

async function loadOperatorRuns(): Promise<AgentRun[]> {
  const db = getDb();
  return await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.agent, 'operator'), eq(agentRuns.status, 'succeeded')))
    .orderBy(desc(agentRuns.startedAt))
    .limit(50);
}

function flatten(runs: AgentRun[]): FlatDecision[] {
  const out: FlatDecision[] = [];
  for (const r of runs) {
    const output = (r.output ?? {}) as { decisions?: unknown };
    const decisions = Array.isArray(output.decisions) ? output.decisions : [];
    for (const d of decisions as Array<Record<string, unknown>>) {
      out.push({
        runId: r.id,
        startedAt: r.startedAt,
        type: String(d.type ?? '?'),
        target: String(d.target ?? '-'),
        rationale: String(d.rationale ?? ''),
        eventEmitted: (d.eventEmitted as string | null) ?? null,
      });
    }
  }
  return out;
}

export default async function ControlPage() {
  const [state, runs] = await Promise.all([getSystemState(), loadOperatorRuns()]);
  const decisions = flatten(runs);
  // IANA zone list for the time-zone picker, resolved server-side so the option
  // set is stable regardless of the viewer's browser.
  const timeZones = Intl.supportedValuesOf('timeZone');

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Operator Control</h1>
        <p className="text-sm text-slate-400 mt-1">
          Master switch, autonomy mode, and KPI targets for the orchestrator agent.
        </p>
      </header>

      <ControlForms state={state} timeZones={timeZones} />

      <section>
        <header className="flex items-baseline justify-between mb-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Recent decisions
          </h2>
          <span className="text-xs text-slate-500">
            {decisions.length} from {runs.length} run{runs.length === 1 ? '' : 's'}
          </span>
        </header>
        {decisions.length === 0 ? (
          <p className="text-sm text-slate-500">
            No operator runs yet. Enable the operator above and wait for the next cron tick.
          </p>
        ) : (
          <div className="rounded-lg border border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-left px-3 py-2">Type</th>
                  <th className="text-left px-3 py-2">Target</th>
                  <th className="text-left px-3 py-2">Rationale</th>
                  <th className="text-left px-3 py-2">Event</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {decisions.map((d, i) => (
                  <tr key={`${d.runId}:${i}`} className="hover:bg-slate-900/40">
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                      <Timestamp value={d.startedAt} />
                    </td>
                    <td className="px-3 py-2">
                      <DecisionTag type={d.type} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{d.target}</td>
                    <td className="px-3 py-2 text-slate-300">{d.rationale}</td>
                    <td className="px-3 py-2 text-xs text-slate-500 font-mono">
                      {d.eventEmitted ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function DecisionTag({ type }: { type: string }) {
  const tone =
    type === 'no_op'
      ? 'text-slate-500'
      : type === 'pause_agent'
      ? 'text-red-300'
      : type === 'niche_approve' || type === 'cross_sell'
      ? 'text-emerald-300'
      : 'text-sky-300';
  return <span className={`${tone} font-mono text-xs`}>{type}</span>;
}

