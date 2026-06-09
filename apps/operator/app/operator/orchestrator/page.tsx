import { listThreads, getThread, getOrchestratorEnabled, getGlobalBudget } from './actions';
import { OrchestratorChat } from './OrchestratorChat';
import { OrchestratorPower } from './OrchestratorPower';
import { GlobalBudgetControl } from './GlobalBudgetControl';

export const dynamic = 'force-dynamic';
// Headroom for the multi-turn brain loop run inside postOrchestratorMessage.
export const maxDuration = 120;

export default async function OrchestratorPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const { thread } = await searchParams;
  const [threads, active, enabled, budget] = await Promise.all([
    listThreads(),
    thread ? getThread(thread) : Promise.resolve(null),
    getOrchestratorEnabled(),
    getGlobalBudget(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Orchestrator</h1>
          <p className="text-xs text-slate-400">
            Chat with the fleet orchestrator. It answers from live data and can adjust agent
            enable/cap/cadence settings — it can never approve a niche, create a site, or take a
            site live.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <OrchestratorPower enabled={enabled} />
          <GlobalBudgetControl capUsd={budget.capUsd} spentTodayUsd={budget.spentTodayUsd} />
        </div>
      </header>
      {!enabled && (
        <p className="rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-200">
          The orchestrator is turned off — it won&apos;t respond in chat and the auto-supervision
          pass is paused. Turn it back on with the toggle above.
        </p>
      )}
      <OrchestratorChat threads={threads} active={active} enabled={enabled} />
    </div>
  );
}
