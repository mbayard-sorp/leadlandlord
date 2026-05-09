import Link from 'next/link';
import { desc, eq, inArray, and } from 'drizzle-orm';
import { getDb, backlinks, sites, type Backlink, type Site } from '@leadlandlord/db';
import { getApolloMonthlyUsage } from '../actions';
import { ProspectRowActions } from './ProspectActions';
import { ProspectRunner } from './ProspectRunner';

export const dynamic = 'force-dynamic';

/**
 * Prospect-mode review page. Surfaces guest_post backlink rows generated
 * by Backlink Builder's `prospect` mode (DataForSEO discovery → Apollo
 * enrichment → queue). Operator approves & sends or rejects each row;
 * acceptance signals (rank-band × editor-title × niche) are computed
 * inline from `metadata.prospect` for the autonomy graduation decision.
 *
 * The Apollo monthly cap is the binding constraint during free-tier use
 * (75 lookups/month) — surfaced at the top so we can pace runs.
 */

const ALL_STATUSES = ['pending', 'submitted', 'live', 'rejected', 'lost'] as const;
type StatusFilter = (typeof ALL_STATUSES)[number] | 'all';

interface PageProps {
  searchParams?: Promise<{ status?: string }>;
}

interface ProspectMetadata {
  run?: boolean;
  dfsRank?: number;
  referringDomainsToCompetitors?: number;
  backlinksCount?: number;
  firstSeen?: string | null;
  editorTitle?: string | null;
  editorEmailStatus?: string | null;
  apolloOrgId?: string | null;
  apolloPersonId?: string | null;
  niche?: string;
  minDomainRank?: number;
  seeds?: string[];
  needsManualEditor?: boolean;
  apolloError?: string | null;
  apolloBudgetExhausted?: boolean;
}

function isStatus(v: string | undefined): v is StatusFilter {
  return v === 'all' || (ALL_STATUSES as readonly string[]).includes(v ?? '');
}

async function loadProspectRows(filter: StatusFilter): Promise<Backlink[]> {
  const db = getDb();
  // Prospect rows are guest_post-typed; we filter further by metadata in
  // memory because metadata is jsonb and the query layer doesn't have a
  // cheap path-existence operator wired up here.
  const rowsRaw =
    filter === 'all'
      ? await db
          .select()
          .from(backlinks)
          .where(eq(backlinks.type, 'guest_post'))
          .orderBy(desc(backlinks.createdAt))
          .limit(500)
      : await db
          .select()
          .from(backlinks)
          .where(and(eq(backlinks.type, 'guest_post'), eq(backlinks.status, filter)))
          .orderBy(desc(backlinks.createdAt))
          .limit(500);
  return rowsRaw.filter((r) => {
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    const p = md.prospect as ProspectMetadata | undefined;
    return p?.run === true;
  });
}

async function loadSitesByIds(ids: string[]): Promise<Map<string, Site>> {
  if (ids.length === 0) return new Map();
  const db = getDb();
  const rows = await db.select().from(sites).where(inArray(sites.id, ids));
  return new Map(rows.map((s) => [s.id, s]));
}

async function loadAllSitesForRunner(): Promise<
  { id: string; label: string; hasCompetitorSeeds: boolean }[]
> {
  const db = getDb();
  const rows = await db
    .select({
      id: sites.id,
      niche: sites.niche,
      city: sites.city,
      state: sites.state,
      competitorSeeds: sites.competitorSeeds,
    })
    .from(sites)
    .limit(200);
  return rows.map((r) => ({
    id: r.id,
    label: `${r.niche} — ${r.city}, ${r.state}`,
    hasCompetitorSeeds: Array.isArray(r.competitorSeeds) && r.competitorSeeds.length > 0,
  }));
}

function rankBand(rank: number): string {
  if (rank < 200) return '0–199';
  if (rank < 400) return '200–399';
  if (rank < 600) return '400–599';
  if (rank < 800) return '600–799';
  return '800–1000';
}

interface AcceptanceCell {
  total: number;
  approved: number; // submitted/live
  rejected: number;
}

function computeAcceptanceByRankBand(rows: Backlink[]): Record<string, AcceptanceCell> {
  const out: Record<string, AcceptanceCell> = {};
  for (const r of rows) {
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    const p = md.prospect as ProspectMetadata | undefined;
    if (!p) continue;
    const band = rankBand(p.dfsRank ?? 0);
    const cell = out[band] ?? { total: 0, approved: 0, rejected: 0 };
    cell.total += 1;
    if (r.status === 'submitted' || r.status === 'live') cell.approved += 1;
    else if (r.status === 'rejected') cell.rejected += 1;
    out[band] = cell;
  }
  return out;
}

export default async function ProspectsPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const filter: StatusFilter = isStatus(params.status) ? params.status : 'pending';

  const [rows, allRows, runnerSites, apolloUsage] = await Promise.all([
    loadProspectRows(filter),
    loadProspectRows('all'),
    loadAllSitesForRunner(),
    getApolloMonthlyUsage(),
  ]);
  const siteMap = await loadSitesByIds([...new Set(rows.map((r) => r.siteId))]);
  const acceptance = computeAcceptanceByRankBand(allRows);

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
        <h1 className="text-2xl font-semibold">Backlink prospects</h1>
        <p className="text-sm text-slate-400 mt-1">
          DataForSEO-discovered guest-post targets enriched with editor contacts via Apollo. Each
          row is a drafted pitch awaiting operator approval before send (training-wheels mode).
        </p>
      </header>

      {/* Apollo cap surface */}
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

      <ProspectRunner sites={runnerSites} />

      {/* Acceptance metrics — autonomy-graduation signal */}
      {Object.keys(acceptance).length > 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-2">
            Acceptance by DFS rank band{' '}
            <span className="text-xs text-slate-500 font-normal">
              (autonomy trigger: ≥85% over n≥100)
            </span>
          </h2>
          <table className="w-full text-xs">
            <thead className="text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="text-left py-1 pr-3">Rank band</th>
                <th className="text-right py-1 pr-3">n</th>
                <th className="text-right py-1 pr-3">Approved</th>
                <th className="text-right py-1 pr-3">Rejected</th>
                <th className="text-right py-1">Approval rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {Object.entries(acceptance)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([band, cell]) => {
                  const decided = cell.approved + cell.rejected;
                  const rate = decided > 0 ? Math.round((cell.approved / decided) * 100) : null;
                  return (
                    <tr key={band}>
                      <td className="py-1 pr-3 font-mono text-slate-300">{band}</td>
                      <td className="text-right py-1 pr-3 text-slate-200">{cell.total}</td>
                      <td className="text-right py-1 pr-3 text-emerald-300">{cell.approved}</td>
                      <td className="text-right py-1 pr-3 text-red-300">{cell.rejected}</td>
                      <td className="text-right py-1 text-slate-200">
                        {rate == null ? '—' : `${rate}%`}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Status filter */}
      <nav className="flex flex-wrap gap-2 text-xs">
        {(['pending', 'submitted', 'live', 'rejected', 'lost', 'all'] as const).map((s) => (
          <Link
            key={s}
            href={`/operator/backlinks/prospects?status=${s}`}
            className={`px-3 py-1 rounded border ${
              filter === s
                ? 'border-sky-700 bg-sky-900/40 text-sky-200'
                : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            {s}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
          No prospect rows with status={filter}.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Site</th>
                <th className="text-left px-3 py-2">Target domain</th>
                <th className="text-right px-3 py-2">DFS rank</th>
                <th className="text-left px-3 py-2">Editor</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Pitch</th>
                <th className="text-left px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((r) => {
                const md = (r.metadata ?? {}) as Record<string, unknown>;
                const p = (md.prospect ?? {}) as ProspectMetadata;
                const editorEmail =
                  typeof md.targetEditorEmail === 'string' ? md.targetEditorEmail : null;
                const site = siteMap.get(r.siteId);
                return (
                  <tr key={r.id} className="hover:bg-slate-900/40 align-top">
                    <td className="px-3 py-2 text-xs text-slate-300">
                      {site ? `${site.niche} — ${site.city}` : r.siteId.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-200">
                      {r.sourceDomain}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-slate-300">
                      {p.dfsRank ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {p.needsManualEditor && !editorEmail ? (
                        <div className="text-amber-300">
                          ⚠ needs manual editor lookup
                          {p.apolloError ? (
                            <div className="text-slate-500 mt-0.5">Apollo: 404</div>
                          ) : p.apolloBudgetExhausted ? (
                            <div className="text-slate-500 mt-0.5">Apollo cap reached</div>
                          ) : null}
                        </div>
                      ) : (
                        <>
                          <div className="text-slate-200">{p.editorTitle ?? '—'}</div>
                          <div className="text-slate-400 font-mono">{editorEmail ?? ''}</div>
                          <div className="text-slate-500">
                            {p.editorEmailStatus ? `(${p.editorEmailStatus})` : ''}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-300 max-w-md">
                      {r.subjectLine ? (
                        <div className="font-medium text-slate-200">{r.subjectLine}</div>
                      ) : null}
                      {r.pitchDraft ? (
                        <div className="text-slate-400 mt-0.5">{truncate(r.pitchDraft, 220)}</div>
                      ) : null}
                      {r.rejectionReason ? (
                        <div className="text-red-300/80 text-xs mt-0.5">
                          reason: {truncate(r.rejectionReason, 160)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === 'pending' ? (
                        <ProspectRowActions
                          id={r.id}
                          hasEmail={!!editorEmail}
                          needsManualEditor={p.needsManualEditor === true}
                        />
                      ) : null}
                    </td>
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

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'live' || status === 'submitted'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : status === 'pending'
      ? 'bg-amber-900/30 text-amber-300 border-amber-700/50'
      : status === 'rejected' || status === 'lost'
      ? 'bg-red-900/40 text-red-300 border-red-700/50'
      : 'bg-slate-800/60 text-slate-300 border-slate-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{status}</span>
  );
}
