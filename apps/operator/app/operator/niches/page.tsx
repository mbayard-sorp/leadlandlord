import { desc, inArray } from 'drizzle-orm';
import { getDb, niches, sites } from '@leadlandlord/db';
import { GEO_SHARE_PRIOR } from '@leadlandlord/agents/niche-hunter';
import Link from 'next/link';
import { RunForm } from './RunForm';
import { DecisionButtons } from './DecisionButtons';
import { StatusBar } from './StatusBar';
import { BuildLink } from './BuildLink';
import { ValidateButton } from './ValidateButton';
import { RawResponseDrawer } from './RawResponseDrawer';
import { CalibrationDrawer } from './CalibrationDrawer';

export const dynamic = 'force-dynamic';

export default async function NichesPage() {
  const db = getDb();
  const rows = await db.select().from(niches).orderBy(desc(niches.score)).limit(200);

  const pending = rows.filter((r) => r.decision === 'pending');
  const approved = rows.filter((r) => r.decision === 'approved' || r.decision === 'approved_dry_run');
  const rejected = rows.filter((r) => r.decision === 'rejected');

  // Map nicheId -> siteId for approved niches so each row can show a build link.
  const approvedIds = approved.map((r) => r.id);
  const siteByNiche = new Map<string, string>();
  if (approvedIds.length > 0) {
    const siteRows = await db
      .select({ id: sites.id, nicheId: sites.nicheId })
      .from(sites)
      .where(inArray(sites.nicheId, approvedIds));
    for (const s of siteRows) {
      if (s.nicheId) siteByNiche.set(s.nicheId, s.id);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-semibold">Niches</h1>
          <Link
            href="/operator/approvals/niches"
            className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded"
          >
            Approvals inbox
          </Link>
        </div>
        <p className="text-sm text-slate-400 mt-1">
          Niche Hunter brainstorms candidates with Claude, scores each with DataForSEO real
          search volume + keyword difficulty, ranks them. Approve a niche to dispatch Site
          Builder via the agent_events queue.
        </p>
      </header>

      <RunForm />

      <StatusBar />

      <Section title={`Pending review (${pending.length})`}>
        {pending.length === 0 ? (
          <Empty>Nothing pending. Run Niche Hunter above to populate.</Empty>
        ) : (
          <Table rows={pending} showButtons />
        )}
      </Section>

      <Section title={`Approved (${approved.length})`} muted>
        {approved.length === 0 ? (
          <Empty>No approved niches yet.</Empty>
        ) : (
          <Table rows={approved} showBuildLink siteByNiche={siteByNiche} />
        )}
      </Section>

      <Section title={`Rejected (${rejected.length})`} muted>
        {rejected.length === 0 ? <Empty>No rejected niches yet.</Empty> : <Table rows={rejected} />}
      </Section>
    </div>
  );
}

function Section({
  title,
  muted,
  children,
}: {
  title: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className={`text-sm font-semibold uppercase tracking-wide mb-2 ${muted ? 'text-slate-500' : 'text-slate-300'}`}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/20 p-4 text-sm text-slate-500">
      {children}
    </div>
  );
}

type NicheRow = {
  id: string;
  niche: string;
  city: string;
  state: string;
  searchVolume: number | null;
  kd: number | null;
  estAvgJobValueUsd: string | null;
  estCloseRate: string | null;
  score: string | null;
  rationale: string | null;
  volumeSource: string;
  estSearchVolume: number | null;
  dfsSearchVolume: number | null;
  dfsClusterVolume: number | null;
  dfsKd: number | null;
  validatedAt: Date | null;
  dfsRaw: unknown;
  decision: string;
  contractorCount: number | null;
  rentabilityScore: string | null;
};

function VolCell({ row }: { row: NicheRow }) {
  const isValidated = row.volumeSource === 'dataforseo';
  const estimate = row.estSearchVolume ?? row.searchVolume;

  if (isValidated && row.dfsSearchVolume !== null) {
    return (
      <span className="text-xs">
        {estimate !== null ? <span className="text-slate-400">{estimate} est</span> : null}
        {estimate !== null ? <span className="text-slate-500"> → </span> : null}
        <span className="text-emerald-400 font-medium">{row.dfsSearchVolume} DFS</span>
      </span>
    );
  }

  if (estimate !== null) {
    return <span className="text-xs text-slate-400">{estimate} est</span>;
  }

  return <span className="text-slate-500">—</span>;
}

function SourceBadge({ volumeSource }: { volumeSource: string }) {
  if (volumeSource === 'dataforseo') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs font-medium text-emerald-300 border border-emerald-800">
        validated
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-400 border border-slate-700">
      estimate
    </span>
  );
}

function Table({
  rows,
  showButtons = false,
  showBuildLink = false,
  siteByNiche,
}: {
  rows: NicheRow[];
  showButtons?: boolean;
  showBuildLink?: boolean;
  siteByNiche?: Map<string, string>;
}) {
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-slate-800 bg-slate-900/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
            <Th>Niche</Th>
            <Th className="hidden md:table-cell">City</Th>
            <Th>Score</Th>
            <Th className="hidden lg:table-cell">Rentability</Th>
            <Th className="hidden md:table-cell">Vol</Th>
            <Th className="hidden md:table-cell">Source</Th>
            <Th className="hidden md:table-cell">KD</Th>
            <Th className="hidden lg:table-cell">Contractors</Th>
            <Th className="hidden lg:table-cell">Job $</Th>
            <Th className="hidden lg:table-cell">Close</Th>
            <Th className="hidden lg:table-cell">Rationale</Th>
            <Th>Validate</Th>
            {showButtons && <Th>Decision</Th>}
            {showBuildLink && <Th>Build</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-800/60 last:border-0">
              <Td className="break-words">
                {r.niche}
                <div className="text-xs text-slate-500 md:hidden">{r.city}, {r.state}</div>
              </Td>
              <Td className="hidden md:table-cell">{r.city}, {r.state}</Td>
              <Td className="font-semibold">{r.score ?? '—'}</Td>
              <Td className="hidden lg:table-cell">
                {r.rentabilityScore !== null ? (
                  <span className="font-medium text-violet-400">{r.rentabilityScore}</span>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </Td>
              <Td className="hidden md:table-cell">
                <VolCell row={r} />
              </Td>
              <Td className="hidden md:table-cell">
                <SourceBadge volumeSource={r.volumeSource} />
              </Td>
              <Td className="hidden md:table-cell">
                {r.dfsKd !== null ? (
                  <span>{r.dfsKd} <span className="text-slate-500 text-xs">DFS</span></span>
                ) : (r.kd ?? '—')}
              </Td>
              <Td className="hidden lg:table-cell">
                {r.contractorCount !== null ? r.contractorCount : <span className="text-slate-500">—</span>}
              </Td>
              <Td className="hidden lg:table-cell">${r.estAvgJobValueUsd ?? '—'}</Td>
              <Td className="hidden lg:table-cell">{r.estCloseRate ? `${(Number(r.estCloseRate) * 100).toFixed(0)}%` : '—'}</Td>
              <Td className="text-xs text-slate-400 max-w-md hidden lg:table-cell">
                {r.rationale}
                <CalibrationDrawer
                  claudeEstimate={r.estSearchVolume ?? r.searchVolume}
                  dfsSeedVolume={r.dfsSearchVolume}
                  clusterVolume={r.dfsClusterVolume}
                  geoSharePrior={GEO_SHARE_PRIOR}
                  score={r.score}
                />
                {r.dfsRaw != null && <RawResponseDrawer dfsRaw={r.dfsRaw} />}
              </Td>
              <Td>
                <ValidateButton
                  nicheId={r.id}
                  alreadyValidated={r.volumeSource === 'dataforseo'}
                />
              </Td>
              {showButtons && (
                <Td>
                  <DecisionButtons id={r.id} volumeSource={r.volumeSource} />
                </Td>
              )}
              {showBuildLink && (
                <Td>
                  <BuildLink nicheId={r.id} initialSiteId={siteByNiche?.get(r.id) ?? null} />
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
