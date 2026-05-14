import Link from 'next/link';
import { sql, desc, eq, inArray, and, gte } from 'drizzle-orm';
import {
  getDb,
  seoRecommendations,
  seoMetricsDaily,
  sites,
  type SeoRecommendation,
  type Site,
} from '@leadlandlord/db';
import { ReviewActions } from './ReviewActions';

export const dynamic = 'force-dynamic';

interface RankingRow {
  siteId: string;
  niche: string;
  city: string;
  state: string;
  status: string;
  avgPosition: number | null;
  totalClicks: number;
  totalImpressions: number;
}

async function loadPending(): Promise<SeoRecommendation[]> {
  const db = getDb();
  return await db
    .select()
    .from(seoRecommendations)
    .where(inArray(seoRecommendations.status, ['pending', 'awaiting_review']))
    .orderBy(desc(seoRecommendations.createdAt))
    .limit(50);
}

async function loadAutoApplied(): Promise<SeoRecommendation[]> {
  const db = getDb();
  return await db
    .select()
    .from(seoRecommendations)
    .where(eq(seoRecommendations.status, 'auto_applied'))
    .orderBy(desc(seoRecommendations.appliedAt))
    .limit(20);
}

async function loadActiveSites(): Promise<Site[]> {
  const db = getDb();
  return await db
    .select()
    .from(sites)
    .where(inArray(sites.status, ['warming', 'live', 'rented']))
    .limit(500);
}

async function loadRankingSummary(activeSites: Site[]): Promise<RankingRow[]> {
  if (activeSites.length === 0) return [];
  const db = getDb();
  const ids = activeSites.map((s) => s.id);

  // 14 days ago as YYYY-MM-DD (text column).
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const cutoffYmd = `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}-${String(cutoff.getUTCDate()).padStart(2, '0')}`;

  const rows = await db
    .select({
      siteId: seoMetricsDaily.siteId,
      avgPosition: sql<string>`AVG(${seoMetricsDaily.position})::text`,
      totalClicks: sql<number>`COALESCE(SUM(${seoMetricsDaily.clicks}), 0)::int`,
      totalImpressions: sql<number>`COALESCE(SUM(${seoMetricsDaily.impressions}), 0)::int`,
    })
    .from(seoMetricsDaily)
    .where(and(inArray(seoMetricsDaily.siteId, ids), gte(seoMetricsDaily.date, cutoffYmd)))
    .groupBy(seoMetricsDaily.siteId);

  const byId = new Map(rows.map((r) => [r.siteId, r]));
  return activeSites
    .map((s) => {
      const r = byId.get(s.id);
      const avg = r?.avgPosition ? Number(r.avgPosition) : null;
      return {
        siteId: s.id,
        niche: s.niche,
        city: s.city,
        state: s.state,
        status: s.status,
        avgPosition: avg,
        totalClicks: r?.totalClicks ?? 0,
        totalImpressions: r?.totalImpressions ?? 0,
      };
    })
    .sort((a, b) => b.totalClicks - a.totalClicks);
}

export default async function SeoDashboardPage() {
  const activeSites = await loadActiveSites();
  const [pending, autoApplied, ranking] = await Promise.all([
    loadPending(),
    loadAutoApplied(),
    loadRankingSummary(activeSites),
  ]);

  const siteName = new Map(activeSites.map((s) => [s.id, `${s.niche} — ${s.city}, ${s.state}`]));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">SEO</h1>
        <p className="text-sm text-slate-400 mt-1">
          Recommendation queue, recent auto-applied changes, and per-site ranking.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">
          Recommendations queue ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <Empty>No pending recommendations. SEO Operator runs Mon 08:00 UTC.</Empty>
        ) : (
          <div className="rounded-lg border border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Site</th>
                  <th className="text-left px-3 py-2">Type</th>
                  <th className="text-left px-3 py-2">Target page</th>
                  <th className="text-left px-3 py-2">Rationale</th>
                  <th className="text-left px-3 py-2">Impact</th>
                  <th className="text-left px-3 py-2">Risk</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Created</th>
                  <th className="text-left px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {pending.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-900/40 align-top">
                    <td className="px-3 py-2">
                      <Link
                        href={`/operator/sites/${r.siteId}`}
                        className="text-sky-400 hover:text-sky-300 text-xs"
                      >
                        {siteName.get(r.siteId) ?? r.siteId.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.type}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">
                      {r.targetPage ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-300 text-xs max-w-md">
                      {truncate(r.rationale, 160)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.estImpactScore != null ? Number(r.estImpactScore).toFixed(1) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <RiskBadge level={r.riskLevel} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === 'awaiting_review' ? <ReviewActions id={r.id} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">
          Recently auto-applied ({autoApplied.length})
        </h2>
        {autoApplied.length === 0 ? (
          <Empty>Nothing auto-applied yet.</Empty>
        ) : (
          <div className="rounded-lg border border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Site</th>
                  <th className="text-left px-3 py-2">Type</th>
                  <th className="text-left px-3 py-2">Target page</th>
                  <th className="text-left px-3 py-2">Rationale</th>
                  <th className="text-left px-3 py-2">Applied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {autoApplied.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-900/40 align-top">
                    <td className="px-3 py-2">
                      <Link
                        href={`/operator/sites/${r.siteId}`}
                        className="text-sky-400 hover:text-sky-300 text-xs"
                      >
                        {siteName.get(r.siteId) ?? r.siteId.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.type}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">
                      {r.targetPage ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-slate-300 text-xs max-w-md">
                      {truncate(r.rationale, 160)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {r.appliedAt ? new Date(r.appliedAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">
          Per-site ranking — last 14 days
        </h2>
        {ranking.length === 0 ? (
          <Empty>No active sites with seo_metrics_daily yet.</Empty>
        ) : (
          <div className="rounded-lg border border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Site</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Avg position</th>
                  <th className="text-left px-3 py-2">Clicks (14d)</th>
                  <th className="text-left px-3 py-2">Impressions (14d)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {ranking.map((r) => (
                  <tr key={r.siteId} className="hover:bg-slate-900/40">
                    <td className="px-3 py-2">
                      <Link
                        href={`/operator/sites/${r.siteId}`}
                        className="text-sky-400 hover:text-sky-300"
                      >
                        {r.niche}
                      </Link>
                      <span className="ml-2 text-xs text-slate-500">
                        {r.city}, {r.state}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-block px-2 py-0.5 rounded border border-slate-700 bg-slate-800/60 text-slate-300 text-xs">
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {r.avgPosition != null ? r.avgPosition.toFixed(1) : '—'}
                    </td>
                    <td className="px-3 py-2">{r.totalClicks.toLocaleString()}</td>
                    <td className="px-3 py-2 text-slate-400">
                      {r.totalImpressions.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

function RiskBadge({ level }: { level: string }) {
  const tone =
    level === 'low'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : level === 'high'
      ? 'bg-red-900/40 text-red-300 border-red-700/50'
      : 'bg-amber-900/30 text-amber-300 border-amber-700/50';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{level}</span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'auto_applied' || status === 'approved'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : status === 'awaiting_review'
      ? 'bg-amber-900/30 text-amber-300 border-amber-700/50'
      : status === 'rejected' || status === 'failed' || status === 'blocked'
      ? 'bg-red-900/40 text-red-300 border-red-700/50'
      : 'bg-slate-800/60 text-slate-300 border-slate-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{status}</span>
  );
}
