import { getApolloMonthlyUsage } from '../actions';
import { ProspectWorkflow } from './ProspectWorkflow';

export const dynamic = 'force-dynamic';

export default async function ProspectsPage() {
  const apolloUsage = await getApolloMonthlyUsage();

  const apolloPct = Math.round((apolloUsage.used / Math.max(1, apolloUsage.cap)) * 100);
  const apolloTone =
    apolloUsage.remaining === 0
      ? 'border-red-700/60 bg-red-900/30 text-red-200'
      : apolloUsage.remaining < 10
      ? 'border-amber-700/60 bg-amber-900/30 text-amber-200'
      : 'border-slate-700 bg-slate-900/40 text-slate-300';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Backlink prospects</h1>
        <p className="text-sm text-slate-400 mt-1">
          DataForSEO-discovered guest-post targets enriched with editor contacts via Apollo.
        </p>
      </header>

      {/* Apollo cap — server-rendered so it&apos;s visible before JS hydrates */}
      <div className={`rounded-lg border p-4 ${apolloTone}`}>
        <div className="flex items-center justify-between text-sm">
          <div>
            <span className="font-semibold">Apollo monthly usage</span>{' '}
            <span className="text-xs opacity-80">({apolloUsage.monthKey})</span>
          </div>
          <div className="font-mono text-xs">
            {apolloUsage.used} / {apolloUsage.cap} ({apolloUsage.remaining} remaining)
          </div>
        </div>
        <div className="mt-2 h-1.5 bg-slate-950/60 rounded overflow-hidden">
          <div
            className={`h-full ${
              apolloUsage.remaining === 0
                ? 'bg-red-500'
                : apolloUsage.remaining < 10
                ? 'bg-amber-500'
                : 'bg-emerald-500'
            }`}
            style={{ width: `${Math.min(100, apolloPct)}%` }}
          />
        </div>
      </div>

      <ProspectWorkflow />
    </div>
  );
}
