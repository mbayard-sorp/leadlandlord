import { desc, ne, sql } from 'drizzle-orm';
import { getDb, buildsellSites, type BuildsellSite } from '@leadlandlord/db';
import { BuildSellTabs } from '@/components/BuildSellTabs';
import { fetchBuildSellVisibility, type BsSiteVisibility } from '@/lib/sanity-read';
import { BuildSellPortfolioTable } from './BuildSellPortfolioTable';
import type { BsAttentionItem, BsKpis, BsPortfolioRow, BuildsellStatus } from './types';

// Render on demand — this is a live operator dashboard. Prerendering couples
// the build to DB schema state (a hazard the R&R portfolio page documents).
export const dynamic = 'force-dynamic';
export const revalidate = 30;

const DOMAIN_PENDING_DAYS = 3;
const INVOICE_OVERDUE_DAYS = 7;

interface KpiAggRow {
  total: number;
  draft: number;
  building: number;
  invoiced: number;
  paid: number;
  live: number;
  failed: number;
  total_sold_usd: string;
}

interface LeadAggRow {
  site_id: string;
  leads_count: number;
  failure_count: number;
  leads_30d: number;
}

interface AccessAggRow {
  site_id: string;
  active_grants: number;
}

/** db.execute returns an array or a { rows } object depending on the driver. */
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

async function loadKpiAgg(): Promise<KpiAggRow> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
      COUNT(*) FILTER (WHERE status = 'building')::int AS building,
      COUNT(*) FILTER (WHERE status = 'invoiced')::int AS invoiced,
      COUNT(*) FILTER (WHERE status = 'paid')::int AS paid,
      COUNT(*) FILTER (WHERE status = 'live')::int AS live,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COALESCE(SUM(price_usd) FILTER (WHERE status IN ('paid', 'live')), 0)::text AS total_sold_usd
    FROM buildsell_sites
  `);
  const [row] = rowsOf<KpiAggRow>(result);
  return (
    row ?? {
      total: 0, draft: 0, building: 0, invoiced: 0, paid: 0, live: 0, failed: 0,
      total_sold_usd: '0',
    }
  );
}

async function loadLeadAgg(): Promise<LeadAggRow[]> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT
      buildsell_site_id::text AS site_id,
      COUNT(*)::int AS leads_count,
      COUNT(*) FILTER (WHERE forward_status = 'failed' OR klaviyo_status = 'failed')::int AS failure_count,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS leads_30d
    FROM buildsell_site_leads
    GROUP BY buildsell_site_id
  `);
  return rowsOf<LeadAggRow>(result);
}

async function loadAccessAgg(): Promise<AccessAggRow[]> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT buildsell_site_id::text AS site_id, COUNT(*)::int AS active_grants
    FROM bs_customer_site_access
    WHERE revoked_at IS NULL
    GROUP BY buildsell_site_id
  `);
  return rowsOf<AccessAggRow>(result);
}

async function loadNonDraftSites(): Promise<BuildsellSite[]> {
  const db = getDb();
  return db
    .select()
    .from(buildsellSites)
    .where(ne(buildsellSites.status, 'draft'))
    .orderBy(desc(buildsellSites.createdAt))
    .limit(200);
}

function iso(d: Date | string | null): string | null {
  if (d == null) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function olderThanDays(d: Date | string | null, days: number): boolean {
  if (d == null) return false;
  const t = (d instanceof Date ? d : new Date(d)).getTime();
  return Date.now() - t > days * 24 * 60 * 60 * 1000;
}

export default async function BuildSellPortfolioPage() {
  const [kpiAgg, leadAgg, accessAgg, sites] = await Promise.all([
    loadKpiAgg(),
    loadLeadAgg(),
    loadAccessAgg(),
    loadNonDraftSites(),
  ]);

  const leadBySite = new Map(leadAgg.map((r) => [r.site_id, r]));
  const accessBySite = new Map(accessAgg.map((r) => [r.site_id, r.active_grants]));

  // Best-effort Sanity read for the non-draft sites' visibility/lock/preset.
  const visibility = await fetchBuildSellVisibility(sites.map((s) => s.id)).catch(
    () => [] as BsSiteVisibility[],
  );
  const visBySite = new Map(visibility.map((v) => [v.siteId, v]));

  const rows: BsPortfolioRow[] = sites.map((s) => {
    const lead = leadBySite.get(s.id);
    const vis = visBySite.get(s.id);
    const meta = (s.metadata ?? null) as { pendingMigration?: { status?: string } } | null;
    return {
      id: s.id,
      businessName: s.businessName,
      trade: s.trade,
      city: s.city,
      state: s.state,
      slug: s.slug,
      status: s.status as BuildsellStatus,
      ownerEmail: s.ownerEmail,
      priceUsd: s.priceUsd,
      themePreset: s.themePreset,
      customDomain: s.customDomain,
      domainStatus: s.domainStatus,
      domainAttachedAt: iso(s.domainAttachedAt),
      domainVerifiedAt: iso(s.domainVerifiedAt),
      invoiceSentAt: iso(s.invoiceSentAt),
      liveAt: iso(s.liveAt),
      lastBuildError: s.lastBuildError,
      createdAt: iso(s.createdAt) ?? '',
      leadsCount: lead?.leads_count ?? 0,
      leadFailureCount: lead?.failure_count ?? 0,
      activeAccessCount: accessBySite.get(s.id) ?? 0,
      migrationPending: meta?.pendingMigration?.status === 'pending',
      draftMode: vis?.draftMode ?? null,
      themeLocked: vis?.themeLocked ?? null,
      // Prefer the live Sanity preset; fall back to the PG column.
      sanityPreset: vis?.preset ?? s.themePreset ?? null,
    };
  });

  // "Needs attention" — derived live from the already-loaded rows.
  const attention: BsAttentionItem[] = [];
  for (const r of rows) {
    if (r.lastBuildError || r.status === 'failed') {
      attention.push({ siteId: r.id, businessName: r.businessName, kind: 'build_failed', detail: r.lastBuildError ?? 'Build failed' });
    }
    if (r.domainStatus === 'pending' && olderThanDays(r.domainAttachedAt, DOMAIN_PENDING_DAYS)) {
      attention.push({ siteId: r.id, businessName: r.businessName, kind: 'domain_pending', detail: `${r.customDomain ?? 'domain'} unverified >${DOMAIN_PENDING_DAYS}d` });
    }
    if (r.leadFailureCount > 0) {
      attention.push({ siteId: r.id, businessName: r.businessName, kind: 'lead_delivery_failed', detail: `${r.leadFailureCount} lead(s) failed to deliver` });
    }
    if (r.migrationPending) {
      attention.push({ siteId: r.id, businessName: r.businessName, kind: 'migration_pending', detail: 'Migrated content awaiting review' });
    }
    if (r.status === 'invoiced' && olderThanDays(r.invoiceSentAt, INVOICE_OVERDUE_DAYS)) {
      attention.push({ siteId: r.id, businessName: r.businessName, kind: 'invoice_overdue', detail: `Invoiced >${INVOICE_OVERDUE_DAYS}d ago, unpaid` });
    }
  }
  const needsAttentionCount = new Set(attention.map((a) => a.siteId)).size;

  const leads30d = leadAgg.reduce((sum, r) => sum + r.leads_30d, 0);

  const kpis: BsKpis = {
    total: kpiAgg.total,
    draft: kpiAgg.draft,
    building: kpiAgg.building,
    invoiced: kpiAgg.invoiced,
    paid: kpiAgg.paid,
    live: kpiAgg.live,
    failed: kpiAgg.failed,
    totalSoldUsd: Number(kpiAgg.total_sold_usd).toFixed(0),
    leads30d,
    needsAttentionCount,
  };

  const siteHost =
    process.env.NEXT_PUBLIC_SITES_PREVIEW_HOST ?? 'leadlandlord-sites.vercel.app';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Build &amp; Sell</h1>
        <p className="text-sm text-slate-400 mt-1">
          Health &amp; config for every site past draft — monitor delivery, domains, and leads,
          and make quick config changes.
        </p>
      </header>

      <BuildSellTabs />

      <KpiRow kpis={kpis} />
      <StatusFunnel kpis={kpis} />
      <NeedsAttentionPanel items={attention} count={needsAttentionCount} />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
          No sites past draft yet — send an invoice from{' '}
          <span className="text-slate-200">Leads &amp; Sites</span> to populate this dashboard.
        </div>
      ) : (
        <BuildSellPortfolioTable rows={rows} siteHost={siteHost} />
      )}
    </div>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

function KpiRow({ kpis }: { kpis: BsKpis }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <KpiCard label="Total sites" value={String(kpis.total)} hint={`${kpis.draft} in draft`} />
      <KpiCard label="Live" value={String(kpis.live)} hint={`${kpis.paid} paid, not yet live`} />
      <KpiCard label="Sold value" value={`$${kpis.totalSoldUsd}`} hint="paid + live" />
      <KpiCard
        label="Needs attention"
        value={String(kpis.needsAttentionCount)}
        hint={`${kpis.leads30d} leads · 30d`}
      />
    </div>
  );
}

const FUNNEL: Array<{ key: keyof BsKpis; label: string; cls: string }> = [
  { key: 'draft', label: 'Draft', cls: 'bg-slate-700 text-slate-200' },
  { key: 'building', label: 'Building', cls: 'bg-amber-900/60 text-amber-300' },
  { key: 'invoiced', label: 'Invoiced', cls: 'bg-blue-900/60 text-blue-300' },
  { key: 'paid', label: 'Paid', cls: 'bg-purple-900/60 text-purple-300' },
  { key: 'live', label: 'Live', cls: 'bg-emerald-900/60 text-emerald-300' },
  { key: 'failed', label: 'Failed', cls: 'bg-red-900/60 text-red-300' },
];

function StatusFunnel({ kpis }: { kpis: BsKpis }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
      <h2 className="text-sm font-semibold text-slate-200 mb-3">Pipeline</h2>
      <div className="flex flex-wrap items-center gap-2">
        {FUNNEL.map((stage, i) => (
          <div key={stage.key} className="flex items-center gap-2">
            <div className={`rounded px-3 py-2 text-center min-w-[72px] ${stage.cls}`}>
              <div className="text-lg font-semibold leading-none">{kpis[stage.key] as number}</div>
              <div className="text-xs mt-1 opacity-80">{stage.label}</div>
            </div>
            {i < FUNNEL.length - 2 && <span className="text-slate-600">→</span>}
            {i === FUNNEL.length - 2 && <span className="text-slate-700 mx-1">·</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

const ATTENTION_LABELS: Record<BsAttentionItem['kind'], string> = {
  build_failed: 'Build failed',
  domain_pending: 'Domain unverified',
  lead_delivery_failed: 'Lead delivery failed',
  migration_pending: 'Migration review',
  invoice_overdue: 'Invoice overdue',
};

function NeedsAttentionPanel({ items, count }: { items: BsAttentionItem[]; count: number }) {
  return (
    <details className="rounded-lg border border-slate-800 bg-slate-900/30 group" open={count > 0}>
      <summary className="cursor-pointer list-none p-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <span className="text-slate-500 transition-transform group-open:rotate-90">▸</span>
          Needs attention
        </h2>
        <span className={`text-xs ${count > 0 ? 'text-amber-300' : 'text-slate-500'}`}>
          {count > 0 ? `${count} site(s)` : 'all clear'}
        </span>
      </summary>
      <div className="px-4 pb-4">
        {items.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing needs attention right now.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {items.map((it, i) => (
              <li key={`${it.siteId}-${it.kind}-${i}`} className="py-2 flex items-center gap-3 text-sm">
                <span className="inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-amber-900/40 text-amber-300 whitespace-nowrap">
                  {ATTENTION_LABELS[it.kind]}
                </span>
                <a
                  href={`/operator/buildsell/${it.siteId}`}
                  className="text-slate-200 hover:text-white underline whitespace-nowrap"
                >
                  {it.businessName}
                </a>
                <span className="text-slate-500 truncate">{it.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
