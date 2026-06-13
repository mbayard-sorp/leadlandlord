import { desc, getDb, contentIdeas, sites, agentRuns, inArray } from '@leadlandlord/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

function fmtUsd(val: string | number | null | undefined): string {
  if (val == null) return '—';
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return '—';
  return `$${n.toFixed(2)}`;
}

function statusPill(status: string): React.ReactNode {
  const tone =
    status === 'published'
      ? 'text-emerald-300 border-emerald-700/50 bg-emerald-900/30'
      : status === 'approved'
      ? 'text-sky-300 border-sky-700/50 bg-sky-900/30'
      : status === 'rejected'
      ? 'text-rose-300 border-rose-700/50 bg-rose-900/30'
      : status === 'pending'
      ? 'text-amber-300 border-amber-700/50 bg-amber-900/30'
      : 'text-slate-400 border-slate-700 bg-slate-800/60';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{status}</span>
  );
}

export default async function ContentCostPage() {
  const db = getDb();

  const ideas = await db
    .select()
    .from(contentIdeas)
    .orderBy(desc(contentIdeas.createdAt))
    .limit(500);

  // Only hydrate the sites and agent_runs actually referenced by these ideas.
  // agent_runs is the highest-churn table in the system (a row per agent tick,
  // each carrying large jsonb input/output), so a bare `select().from(agentRuns)`
  // grows unbounded and eventually trips the neon-http response/time limits —
  // which is what stops this page from loading. Scope it like every other route.
  const siteIds = [...new Set(ideas.map((i) => i.siteId))];
  const runIds = [
    ...new Set(
      ideas
        .flatMap((i) => [i.scoutRunId, i.writerRunId])
        .filter((id): id is string => id != null),
    ),
  ];

  const [refSites, refRuns] = await Promise.all([
    siteIds.length
      ? db
          .select({ id: sites.id, niche: sites.niche, city: sites.city, state: sites.state })
          .from(sites)
          .where(inArray(sites.id, siteIds))
      : Promise.resolve([] as { id: string; niche: string; city: string; state: string }[]),
    runIds.length
      ? db
          .select({ id: agentRuns.id, costUsd: agentRuns.costUsd })
          .from(agentRuns)
          .where(inArray(agentRuns.id, runIds))
      : Promise.resolve([] as { id: string; costUsd: string }[]),
  ]);

  const siteById = new Map(refSites.map((s) => [s.id, s]));
  const runById = new Map(refRuns.map((r) => [r.id, r]));

  const rows = ideas.map((idea) => {
    const site = siteById.get(idea.siteId);
    const scoutRun = idea.scoutRunId ? runById.get(idea.scoutRunId) : null;
    const writerRun = idea.writerRunId ? runById.get(idea.writerRunId) : null;
    const researchCost = scoutRun?.costUsd != null ? parseFloat(scoutRun.costUsd) : null;
    const writingCost = writerRun?.costUsd != null ? parseFloat(writerRun.costUsd) : null;
    const total =
      researchCost != null && writingCost != null
        ? researchCost + writingCost
        : researchCost ?? writingCost ?? null;
    return { idea, site, researchCost, writingCost, total };
  });

  const publishedRows = rows.filter((r) => r.idea.status === 'published');
  const totalSpend = rows.reduce((sum, r) => sum + (r.total ?? 0), 0);
  const publishedCount = publishedRows.length;
  const publishedSpend = publishedRows.reduce((sum, r) => sum + (r.total ?? 0), 0);
  const avgCostPerPublished = publishedCount > 0 ? publishedSpend / publishedCount : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Content costs</h1>
        <p className="text-sm text-slate-400 mt-1">
          Agent spend across all locally-relevant content ideas. Research cost is known at approval time; writing cost accrues on publish.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Total spend" value={fmtUsd(totalSpend)} />
        <Stat label="Published pages" value={String(publishedCount)} />
        <Stat
          label="Avg cost / published page"
          value={avgCostPerPublished != null ? fmtUsd(avgCostPerPublished) : '—'}
        />
      </div>

      <div className="flex items-center gap-3">
        <Link
          href="/operator/approvals/content"
          className="text-xs text-indigo-400 hover:underline"
        >
          Review pending ideas
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
          No content ideas yet. Enable the local content pilot on a site to begin.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-800 overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-sm [&_th]:text-left [&_th]:px-3 [&_th]:py-2 [&_th]:bg-slate-900 [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-slate-500 [&_td]:px-3 [&_td]:py-2 [&_tbody]:divide-y [&_tbody]:divide-slate-800">
            <thead>
              <tr>
                <th>Site</th>
                <th>Topic</th>
                <th className="hidden md:table-cell">Target keyword</th>
                <th>Status</th>
                <th className="hidden md:table-cell">Research $</th>
                <th className="hidden md:table-cell">Writing $</th>
                <th>Total $</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ idea, site, researchCost, writingCost, total }) => (
                <tr key={idea.id} className="hover:bg-slate-900/40">
                  <td className="whitespace-nowrap">
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
                  </td>
                  <td className="break-words max-w-[200px]">{idea.topic}</td>
                  <td className="hidden md:table-cell text-slate-400">{idea.targetKeyword}</td>
                  <td>{statusPill(idea.status)}</td>
                  <td className="hidden md:table-cell text-slate-400">{fmtUsd(researchCost)}</td>
                  <td className="hidden md:table-cell text-slate-600">{fmtUsd(writingCost)}</td>
                  <td className="font-medium">{fmtUsd(total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xl font-semibold mt-1 text-slate-100">{value}</div>
    </div>
  );
}
