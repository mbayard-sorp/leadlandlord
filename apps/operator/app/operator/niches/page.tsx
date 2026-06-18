import { desc, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, niches, sites, nicheScoutRuns, nicheCandidates } from '@leadlandlord/db';
import { resolveDemandVolume } from '@leadlandlord/agents/niche-hunter';
import { ScoutForm } from './ScoutForm';
import { ScoutReport, type ScoutRunData, type ScoutCandidateData } from './ScoutReport';
import { SeedNicheForm } from './SeedNicheForm';
import { StatusBar } from './StatusBar';
import { DrainNowButton } from './DrainNowButton';
import { NicheRow, type NicheRowData } from './NicheRow';
import { CategoryFilter } from './CategoryFilter';
import { CollapsibleSection } from './CollapsibleSection';
import { getNicheBuildStatus, type NicheBuildStatus } from './actions';

export const dynamic = 'force-dynamic';

export default async function NichesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const db = getDb();
  const allRows = await db
    .select()
    .from(niches)
    .orderBy(
      sql`${niches.validatedMonthlyValueUsd} desc nulls last`,
      sql`${niches.estMonthlyValueUsd} desc nulls last`,
      sql`${niches.validatedScore} desc nulls last`,
      desc(niches.score),
    )
    .limit(200);

  // Latest current scout run + its top 100 candidates.
  const [scoutRun] = await db
    .select()
    .from(nicheScoutRuns)
    .where(eq(nicheScoutRuns.status, 'current'))
    .orderBy(desc(nicheScoutRuns.createdAt))
    .limit(1);
  let scoutRunData: ScoutRunData | null = null;
  let scoutCandidates: ScoutCandidateData[] = [];
  if (scoutRun) {
    scoutRunData = {
      id: scoutRun.id,
      createdAt: scoutRun.createdAt.toISOString(),
      states: (scoutRun.states ?? []) as string[],
      categoryFilter: scoutRun.categoryFilter,
      gridCells: scoutRun.gridCells,
      persistedCandidates: scoutRun.persistedCandidates,
      report: scoutRun.report as ScoutRunData['report'],
    };
    const candidateRows = await db
      .select()
      .from(nicheCandidates)
      .where(eq(nicheCandidates.scoutRunId, scoutRun.id))
      .orderBy(asc(nicheCandidates.rank))
      .limit(100);
    scoutCandidates = candidateRows.map((c) => ({
      id: c.id,
      rank: c.rank,
      trade: c.trade,
      category: c.category,
      city: c.city,
      state: c.state,
      population: c.population,
      estMonthlyValueUsd: c.estMonthlyValueUsd,
      winnability: c.winnability ?? null,
      clusterDifficulty: c.clusterDifficulty ?? null,
      isNovelTrade: c.isNovelTrade,
      dataConfidence: c.dataConfidence,
      status: c.status,
      validatedValueUsd: c.validatedValueUsd,
    }));
  }

  // Counts across every category (for the dropdown), computed before filtering.
  const categoryCounts: Record<string, number> = {};
  for (const r of allRows) {
    const key = r.category ?? '__uncategorized__';
    categoryCounts[key] = (categoryCounts[key] ?? 0) + 1;
  }

  const rows = category
    ? allRows.filter((r) =>
        category === '__uncategorized__' ? r.category === null : r.category === category,
      )
    : allRows;

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

  // Pre-fetch build statuses for approved niches that don't yet have a site,
  // so BuildLink can render the correct badge immediately without a loading flash.
  // Only fetched for niches without a live site (the happy path is the siteId link).
  const buildStatusByNiche = new Map<string, NicheBuildStatus>();
  const approvedWithoutSite = approved.filter((r) => !siteByNiche.has(r.id));
  if (approvedWithoutSite.length > 0) {
    const statuses = await Promise.all(
      approvedWithoutSite.map(async (r) => ({ id: r.id, status: await getNicheBuildStatus(r.id) })),
    );
    for (const { id, status } of statuses) {
      buildStatusByNiche.set(id, status);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-semibold">Niches</h1>
        </div>
        <p className="text-sm text-slate-400 mt-1">
          Scout enumerates the trade × city grid and ranks every cell by expected monthly value
          (near-zero cost). Validate the top N with real DataForSEO data; validated candidates
          land below as pending. Approve a niche to dispatch Site Builder via the agent_events
          queue.
        </p>
      </header>

      <ScoutForm />

      {scoutRunData && <ScoutReport run={scoutRunData} candidates={scoutCandidates} />}

      <SeedNicheForm />

      <div className="flex items-center gap-4">
        <div className="shrink-0">
          <CategoryFilter counts={categoryCounts} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <DrainNowButton />
          <StatusBar />
        </div>
      </div>

      <Section title={`Pending review (${pending.length})`}>
        {pending.length === 0 ? (
          <Empty>Nothing pending. Run a scout above, then validate top candidates to populate.</Empty>
        ) : (
          <Table rows={pending} showButtons />
        )}
        <p className="mt-2 text-[11px] text-slate-600">
          $/mo value and rentability use uncalibrated market priors (lead-benchmarks.ts) — treat as order-of-magnitude until calibrated against live results.
        </p>
      </Section>

      <CollapsibleSection title="Approved" count={approved.length} muted>
        {approved.length === 0 ? (
          <Empty>No approved niches yet.</Empty>
        ) : (
          <Table rows={approved} showBuildLink siteByNiche={siteByNiche} buildStatusByNiche={buildStatusByNiche} />
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Rejected" count={rejected.length} muted>
        {rejected.length === 0 ? (
          <Empty>No rejected niches yet.</Empty>
        ) : (
          <Table rows={rejected} showDelete />
        )}
      </CollapsibleSection>
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

function Table({
  rows,
  showButtons = false,
  showBuildLink = false,
  showDelete = false,
  siteByNiche,
  buildStatusByNiche,
}: {
  rows: NicheRowData[];
  showButtons?: boolean;
  showBuildLink?: boolean;
  showDelete?: boolean;
  siteByNiche?: Map<string, string>;
  buildStatusByNiche?: Map<string, NicheBuildStatus>;
}) {
  // Base columns + the optional Decision / Build columns; used for the
  // full-width calibration detail row's colSpan.
  const colSpan = 11 + (showButtons ? 1 : 0) + (showBuildLink ? 1 : 0);
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-slate-800 bg-slate-900/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
            <Th>Category</Th>
            <Th>Niche</Th>
            <Th className="hidden md:table-cell">City</Th>
            <Th>Value</Th>
            <Th>Score</Th>
            <Th>Win%</Th>
            <Th className="hidden lg:table-cell">Rent.</Th>
            <Th className="hidden md:table-cell">Vol</Th>
            <Th className="hidden lg:table-cell">Job $</Th>
            <Th className="hidden lg:table-cell">Rationale</Th>
            <Th>Validate</Th>
            {showButtons && <Th>Decision</Th>}
            {showBuildLink && <Th>Build</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            // Compute demand resolution server-side so the client component never
            // imports resolveDemandVolume (avoids bundling agents into the client).
            // claudeMid mirrors validateNiche: estSearchVolume, falling back to
            // searchVolume for legacy rows that predate the estSearchVolume column.
            const { volume: demandUsed, source: demandSource } = resolveDemandVolume(
              r.dfsSearchVolume ?? 0,
              r.estSearchVolume ?? r.searchVolume ?? 0,
            );
            return (
            <NicheRow
              key={r.id}
              row={r}
              showButtons={showButtons}
              showBuildLink={showBuildLink}
              showDelete={showDelete}
              siteId={siteByNiche?.get(r.id) ?? null}
              initialBuildStatus={buildStatusByNiche?.get(r.id) ?? null}
              colSpan={colSpan}
              demandUsed={demandUsed}
              demandSource={demandSource}
            />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-2 py-2 font-medium ${className}`}>{children}</th>;
}
