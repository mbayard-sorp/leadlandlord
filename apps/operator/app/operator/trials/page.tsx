import Link from 'next/link';
import { getDb, trials, prospects, sites, eq, desc } from '@leadlandlord/db';
import { ForceDecideButtons } from './ForceDecideButtons';

export const dynamic = 'force-dynamic';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
});

function formatDate(date: Date | string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function DecisionBadge({ decision }: { decision: string }) {
  const tone =
    decision === 'won'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : decision === 'lost'
      ? 'bg-rose-900/40 text-rose-300 border-rose-700/50'
      : decision === 'no_decision'
      ? 'bg-slate-800/60 text-slate-400 border-slate-700'
      : 'bg-amber-900/40 text-amber-300 border-amber-700/50';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{decision}</span>
  );
}

export default async function TrialsPage() {
  const db = getDb();

  const rows = await db
    .select({
      id: trials.id,
      siteId: trials.siteId,
      prospectId: trials.prospectId,
      startedAt: trials.startedAt,
      endedAt: trials.endedAt,
      callsCount: trials.callsCount,
      wonCount: trials.wonCount,
      estRevenueUsd: trials.estRevenueUsd,
      decision: trials.decision,
      quotedRentUsd: trials.quotedRentUsd,
      endReportSentAt: trials.endReportSentAt,
      businessName: prospects.businessName,
      niche: sites.niche,
      city: sites.city,
      state: sites.state,
    })
    .from(trials)
    .leftJoin(prospects, eq(trials.prospectId, prospects.id))
    .leftJoin(sites, eq(trials.siteId, sites.id))
    .orderBy(desc(trials.startedAt));

  const now = Date.now();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Trials</h1>
        <p className="text-sm text-slate-400 mt-1">Active and completed trial periods.</p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/20 p-6 text-sm text-slate-500">
          No trials yet.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-slate-800 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                <Th>Prospect</Th>
                <Th>Started</Th>
                <Th>Days left</Th>
                <Th>Calls</Th>
                <Th>Est revenue</Th>
                <Th>Decision</Th>
                <Th>Report sent</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const daysSince = Math.floor((now - new Date(r.startedAt).getTime()) / 86400000);
                const daysLeft = 14 - daysSince;
                const daysLeftLabel =
                  daysLeft < 0 ? `${Math.abs(daysLeft)}d expired` : `${daysLeft}d`;

                return (
                  <tr key={r.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-900/40">
                    <Td>
                      <div className="font-medium text-slate-200">
                        {r.businessName ?? <span className="text-slate-500">unknown</span>}
                      </div>
                      <div className="text-xs text-slate-500">
                        {r.niche ?? '—'}{r.city ? ` / ${r.city}` : ''}
                      </div>
                    </Td>
                    <Td className="text-slate-400 whitespace-nowrap text-xs">
                      {formatDate(r.startedAt)}
                    </Td>
                    <Td>
                      <span
                        className={`text-xs font-mono ${
                          daysLeft < 0 ? 'text-rose-400' : daysLeft <= 3 ? 'text-amber-300' : 'text-slate-300'
                        }`}
                      >
                        {daysLeftLabel}
                      </span>
                    </Td>
                    <Td className="text-slate-400 text-xs">{r.callsCount}</Td>
                    <Td className="text-slate-300 text-xs">
                      {r.estRevenueUsd ? currency.format(Number(r.estRevenueUsd)) : '—'}
                    </Td>
                    <Td>
                      <DecisionBadge decision={r.decision} />
                    </Td>
                    <Td className="text-center">
                      {r.endReportSentAt ? (
                        <span className="text-emerald-400 text-sm">✓</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </Td>
                    <Td>
                      {r.decision === 'pending' ? (
                        <ForceDecideButtons trialId={r.id} />
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
