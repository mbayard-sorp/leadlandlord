import { listThreads, getThread } from './actions';
import { OrchestratorChat } from './OrchestratorChat';

export const dynamic = 'force-dynamic';
// Headroom for the multi-turn brain loop run inside postOrchestratorMessage.
export const maxDuration = 120;

export default async function OrchestratorPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const { thread } = await searchParams;
  const [threads, active] = await Promise.all([
    listThreads(),
    thread ? getThread(thread) : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-lg font-semibold text-slate-100">Orchestrator</h1>
        <p className="text-xs text-slate-400">
          Chat with the fleet orchestrator. It answers from live data and can adjust agent
          enable/cap/cadence settings — it can never approve a niche, create a site, or take a site
          live.
        </p>
      </header>
      <OrchestratorChat threads={threads} active={active} />
    </div>
  );
}
