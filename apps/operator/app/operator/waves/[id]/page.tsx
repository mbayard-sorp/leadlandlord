import { getDb, waves, sites, crossSiteLinks, seoMetricsDaily, sql, eq, and, inArray, gt } from '@leadlandlord/db';
import { count, sum } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { WaveActionButtons } from './WaveActionButtons';
import type { WaveTransition } from '@leadlandlord/db';

export const dynamic = 'force-dynamic';

const STATE_COLORS: Record<string, string> = {
  draft: 'bg-slate-700 text-slate-300',
  launching: 'bg-blue-900/60 text-blue-300',
  aging: 'bg-amber-900/60 text-amber-300',
  linking: 'bg-violet-900/60 text-violet-300',
  backlinking: 'bg-indigo-900/60 text-indigo-300',
  monitoring: 'bg-teal-900/60 text-teal-300',
  completed: 'bg-emerald-900/60 text-emerald-300',
};

function relativeTime(dateish: Date | string): string {
  const ms = Date.now() - new Date(dateish).getTime();
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function daysRemaining(date: Date | null): number | null {
  if (!date) return null;
  const ms = new Date(date).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

interface SiteCard {
  id: string;
  domain: string | null;
  niche: string;
  city: string;
  state: string;
  status: string;
  linkCount: number;
  hasMetrics: boolean;
  clicks7d: number;
  impressions7d: number;
}

async function loadPageData(waveId: string) {
  const db = getDb();

  const waveRows = await db
    .select()
    .from(waves)
    .where(eq(waves.id, waveId))
    .limit(1);

  const wave = waveRows[0];
  if (!wave) return null;

  const siteIds = (wave.siteIds as string[]) ?? [];

  // Per-site data
  let siteCards: SiteCard[] = [];

  if (siteIds.length > 0) {
    const siteRows = await db
      .select({
        id: sites.id,
        domain: sites.domain,
        niche: sites.niche,
        city: sites.city,
        state: sites.state,
        status: sites.status,
      })
      .from(sites)
      .where(inArray(sites.id, siteIds));

    const linkCounts = await db
      .select({ sourceSiteId: crossSiteLinks.sourceSiteId, value: count() })
      .from(crossSiteLinks)
      .where(
        and(
          inArray(crossSiteLinks.sourceSiteId, siteIds),
          eq(crossSiteLinks.status, 'live'),
        ),
      )
      .groupBy(crossSiteLinks.sourceSiteId);

    const linkMap: Record<string, number> = {};
    for (const r of linkCounts) {
      linkMap[r.sourceSiteId] = Number(r.value);
    }

    // 7-day date range
    const cutoff = new Date(Date.now() - 7 * 86_400_000);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const metricAggs = await db
      .select({
        siteId: seoMetricsDaily.siteId,
        clicks: sum(seoMetricsDaily.clicks),
        impressions: sum(seoMetricsDaily.impressions),
      })
      .from(seoMetricsDaily)
      .where(
        and(
          inArray(seoMetricsDaily.siteId, siteIds),
          sql`${seoMetricsDaily.date} >= ${cutoffStr}`,
        ),
      )
      .groupBy(seoMetricsDaily.siteId);

    const metricMap: Record<string, { clicks: string | null; impressions: string | null }> = {};
    for (const r of metricAggs) {
      metricMap[r.siteId] = { clicks: r.clicks, impressions: r.impressions };
    }

    // Sites with any impressions > 0 (indexation proxy — no live GSC call)
    const indexedRows = await db
      .selectDistinct({ siteId: seoMetricsDaily.siteId })
      .from(seoMetricsDaily)
      .where(
        and(
          inArray(seoMetricsDaily.siteId, siteIds),
          gt(seoMetricsDaily.impressions, 0),
        ),
      );
    const indexedSet = new Set(indexedRows.map((r) => r.siteId));

    siteCards = siteRows.map((s) => ({
      id: s.id,
      domain: s.domain,
      niche: s.niche,
      city: s.city,
      state: s.state,
      status: s.status,
      linkCount: linkMap[s.id] ?? 0,
      hasMetrics: indexedSet.has(s.id),
      clicks7d: parseInt(metricMap[s.id]?.clicks ?? '0', 10),
      impressions7d: parseInt(metricMap[s.id]?.impressions ?? '0', 10),
    }));
  }

  return { wave, siteCards };
}

export default async function WaveDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadPageData(id);

  if (!data) notFound();

  const { wave, siteCards } = data;
  const transitions = (wave.transitions as WaveTransition[]) ?? [];
  const aging = daysRemaining(wave.agingUntil);

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <nav className="text-xs text-slate-500 mb-1">
          <Link href="/operator/waves" className="hover:text-slate-300">
            Waves
          </Link>
          {' / '}
          <span className="truncate">{wave.name}</span>
        </nav>
        <div className="flex items-start gap-3 flex-wrap">
          <h1 className="text-xl md:text-2xl font-semibold">{wave.name}</h1>
          <span
            className={`inline-block text-xs px-2 py-0.5 rounded font-medium self-center ${STATE_COLORS[wave.state] ?? 'bg-slate-700 text-slate-300'}`}
          >
            {wave.state}
          </span>
        </div>
        <p className="text-sm text-slate-400 mt-1">{wave.niche}</p>
        {wave.state === 'aging' && aging !== null && (
          <p className="text-sm text-amber-300 mt-1">
            {aging > 0 ? `${aging} day${aging !== 1 ? 's' : ''} remaining in aging` : 'Aging period elapsed'}
          </p>
        )}
      </header>

      {/* State timeline */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          State timeline
        </h2>

        <div className="space-y-2">
          {transitions.length === 0 && (
            <p className="text-sm text-slate-500">No transitions recorded yet.</p>
          )}

          {[...transitions].reverse().map((t, i) => (
            <div key={i} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 w-2 h-2 rounded-full bg-slate-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-slate-300">
                  {t.from} → {t.to}
                </span>
                <div className="text-xs text-slate-500 mt-0.5">
                  {relativeTime(t.at)}
                  {t.evidence && (
                    <span className="ml-2 text-slate-600 font-mono truncate block max-w-sm">
                      {String(t.evidence).slice(0, 120)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Per-site grid */}
      {siteCards.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Sites ({siteCards.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {siteCards.map((s) => (
              <div
                key={s.id}
                className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {s.domain ? (
                      <a
                        href={`https://${s.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-slate-200 hover:text-indigo-300 truncate block"
                      >
                        {s.domain}
                      </a>
                    ) : (
                      <span className="text-sm font-medium text-slate-500 font-mono truncate block">
                        {s.id.slice(0, 8)}...
                      </span>
                    )}
                    <span className="text-xs text-slate-500">
                      {s.niche} — {s.city}, {s.state}
                    </span>
                  </div>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 flex-shrink-0">
                    {s.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-slate-500">Links</div>
                    <div className="text-slate-200 font-medium">{s.linkCount}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Indexed</div>
                    <div className={s.hasMetrics ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
                      {s.hasMetrics ? 'Yes' : 'No'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">7d clicks</div>
                    <div className="text-slate-200 font-medium">{s.clicks7d}</div>
                  </div>
                </div>

                {s.impressions7d > 0 && (
                  <div className="text-xs text-slate-500">
                    {s.impressions7d.toLocaleString()} impressions (7d)
                  </div>
                )}

                <div>
                  <Link
                    href={`/operator/sites/${s.id}`}
                    className="text-xs text-indigo-400 hover:underline"
                  >
                    Site detail
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Manual controls */}
      <section className="space-y-3 border-t border-slate-800 pt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Manual controls
        </h2>
        <p className="text-xs text-slate-500">
          Re-evaluate enqueues a progress event; the agent runs on the next cron cycle (every 6h).
          Force-complete overrides pipeline checks.
        </p>
        <WaveActionButtons waveId={wave.id} />
      </section>
    </div>
  );
}
