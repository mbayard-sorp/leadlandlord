import { getDb, contentIdeas, sites, agentRuns, eq, asc } from '@leadlandlord/db';
import Link from 'next/link';
import { ContentApproveButtons } from './ContentApproveButtons';

export const dynamic = 'force-dynamic';

function ageLabel(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime();
  const hrs = Math.floor(ms / 3600000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtUsd(val: string | number | null | undefined): string {
  if (val == null) return '—';
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return '—';
  return `$${n.toFixed(2)}`;
}

export default async function ContentQueuePage() {
  const db = getDb();

  const [pending, allSites, allRuns] = await Promise.all([
    db.select().from(contentIdeas).where(eq(contentIdeas.status, 'pending')).orderBy(asc(contentIdeas.createdAt)),
    db.select().from(sites),
    db.select().from(agentRuns),
  ]);

  const siteById = new Map(allSites.map((s) => [s.id, s]));
  const runById = new Map(allRuns.map((r) => [r.id, r]));

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-semibold">Content idea queue</h1>
          <Link
            href="/operator/approvals"
            className="text-xs text-slate-400 hover:text-slate-200 border border-slate-700 px-2 py-0.5 rounded"
          >
            All approvals
          </Link>
        </div>
        <p className="text-sm text-slate-400 mt-1">
          Pending locally-relevant content ideas from the local-content-scout, awaiting operator decision.
        </p>
      </header>

      {pending.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/20 p-6 text-sm text-slate-500">
          No pending content ideas. Enable the local content pilot on a site to start receiving scout proposals.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-slate-800 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                <Th>Site</Th>
                <Th>Topic</Th>
                <Th className="hidden md:table-cell">Target keyword</Th>
                <Th className="hidden md:table-cell">Archetype</Th>
                <Th className="hidden lg:table-cell">Angle</Th>
                <Th className="hidden lg:table-cell">Research $</Th>
                <Th className="hidden lg:table-cell">Writing $</Th>
                <Th>Age</Th>
                <Th>Decision</Th>
              </tr>
            </thead>
            <tbody>
              {pending.map((idea) => {
                const site = siteById.get(idea.siteId);
                const scoutRun = idea.scoutRunId ? runById.get(idea.scoutRunId) : null;
                return (
                  <tr key={idea.id} className="border-b border-slate-800/60 last:border-0">
                    <Td className="whitespace-nowrap">
                      {site ? (
                        <Link
                          href={`/operator/sites/${site.id}`}
                          className="text-sky-400 hover:text-sky-300"
                        >
                          {site.niche}
                        </Link>
                      ) : '—'}
                      {site && (
                        <div className="text-xs text-slate-500">
                          {site.city}, {site.state}
                        </div>
                      )}
                    </Td>
                    <Td className="break-words font-medium max-w-[200px]">{idea.topic}</Td>
                    <Td className="hidden md:table-cell text-slate-300">{idea.targetKeyword}</Td>
                    <Td className="hidden md:table-cell">
                      <span className="font-mono text-xs bg-slate-800 px-1.5 py-0.5 rounded">
                        {idea.archetype}
                      </span>
                    </Td>
                    <Td className="hidden lg:table-cell text-xs text-slate-400 max-w-xs">
                      {idea.angle ?? '—'}
                    </Td>
                    <Td className="hidden lg:table-cell text-slate-400">
                      {scoutRun ? fmtUsd(scoutRun.costUsd) : '—'}
                    </Td>
                    <Td className="hidden lg:table-cell text-slate-600">—</Td>
                    <Td className="text-slate-500 whitespace-nowrap">{ageLabel(idea.createdAt)}</Td>
                    <Td>
                      <ContentApproveButtons id={idea.id} />
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

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
