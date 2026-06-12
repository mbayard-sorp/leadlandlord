import { getDb, contentIdeas, sites, agentRuns, eq, asc } from '@leadlandlord/db';
import Link from 'next/link';
import { ContentApproveButtons } from './ContentApproveButtons';
import { SiteFilter, type SiteOption } from './SiteFilter';

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

export default async function ContentQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ site_id?: string }>;
}) {
  const sp = await searchParams;
  const db = getDb();

  const [allPending, allSites, allRuns] = await Promise.all([
    db.select().from(contentIdeas).where(eq(contentIdeas.status, 'pending')).orderBy(asc(contentIdeas.createdAt)),
    db.select().from(sites),
    db.select().from(agentRuns),
  ]);

  const siteById = new Map(allSites.map((s) => [s.id, s]));
  const runById = new Map(allRuns.map((r) => [r.id, r]));

  // Build the dropdown from sites that actually have pending ideas, so the
  // filter only offers sites worth selecting.
  const siteOptions: SiteOption[] = Array.from(
    new Map(
      allPending.map((idea) => {
        const site = siteById.get(idea.siteId);
        const label = site ? `${site.niche} (${site.city}, ${site.state})` : idea.siteId;
        return [idea.siteId, { id: idea.siteId, label }] as const;
      }),
    ).values(),
  ).sort((a, b) => a.label.localeCompare(b.label));

  const pending = sp.site_id ? allPending.filter((idea) => idea.siteId === sp.site_id) : allPending;

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
        {siteOptions.length > 0 && (
          <div className="mt-3">
            <SiteFilter sites={siteOptions} current={sp.site_id} />
          </div>
        )}
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
                    <Td className="break-words font-medium max-w-[240px]">
                      {idea.topic}
                      {idea.storyScaffold && (
                        <details className="mt-1 text-xs font-normal text-slate-400">
                          <summary className="cursor-pointer text-amber-400/80 hover:text-amber-300">
                            Job story — review facts
                          </summary>
                          <dl className="mt-1 space-y-0.5">
                            <div>
                              <dt className="inline text-slate-500">Symptom: </dt>
                              <dd className="inline">{idea.storyScaffold.presentingSymptom}</dd>
                            </div>
                            <div>
                              <dt className="inline text-slate-500">Root cause: </dt>
                              <dd className="inline">{idea.storyScaffold.rootCause}</dd>
                            </div>
                            <div>
                              <dt className="inline text-slate-500">Resolution: </dt>
                              <dd className="inline">{idea.storyScaffold.resolution}</dd>
                            </div>
                          </dl>
                        </details>
                      )}
                    </Td>
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
