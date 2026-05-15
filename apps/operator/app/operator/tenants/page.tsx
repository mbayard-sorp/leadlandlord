import Link from 'next/link';
import { getDb, tenants, sites, outreachEvents, calls, eq, and, desc, sql } from '@leadlandlord/db';

export const dynamic = 'force-dynamic';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
});

function ageLabel(date: Date | string | null): string {
  if (!date) return '—';
  const ms = Date.now() - new Date(date).getTime();
  const hrs = Math.floor(ms / 3600000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function TenantStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'active'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : status === 'trial'
      ? 'bg-sky-900/40 text-sky-300 border-sky-700/50'
      : status === 'past_due'
      ? 'bg-amber-900/40 text-amber-300 border-amber-700/50'
      : 'bg-rose-900/40 text-rose-300 border-rose-700/50';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{status}</span>
  );
}

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: statusFilter } = await searchParams;
  const effectiveStatus = statusFilter ?? 'active';

  const db = getDb();

  const allTenants = await db
    .select({
      id: tenants.id,
      businessName: tenants.businessName,
      contactName: tenants.contactName,
      status: tenants.status,
      monthlyRentUsd: tenants.monthlyRentUsd,
      siteId: tenants.siteId,
      startedAt: tenants.startedAt,
      churnedAt: tenants.churnedAt,
      niche: sites.niche,
      city: sites.city,
      state: sites.state,
    })
    .from(tenants)
    .leftJoin(sites, eq(tenants.siteId, sites.id))
    .orderBy(desc(tenants.startedAt));

  const activeTenants = allTenants.filter((t) => t.status === 'active');
  const activeMrr = activeTenants.reduce((sum, t) => sum + Number(t.monthlyRentUsd ?? 0), 0);

  const cutoff14d = new Date(Date.now() - 14 * 86400000);

  // For churn-risk: find last contact per active tenant.
  // We query max(sentAt) per prospect tied via site, and max(startedAt) from calls per site.
  const activeIds = activeTenants.map((t) => t.id).filter(Boolean);
  const activeSiteIds = activeTenants.map((t) => t.siteId).filter(Boolean) as string[];

  type LastContact = { tenantId: string; lastContact: Date | null };
  let lastContactMap = new Map<string, Date | null>();

  if (activeSiteIds.length > 0) {
    // Last call per site
    const callRows = await db.execute(sql`
      SELECT site_id, MAX(started_at) AS last_call
      FROM ${calls}
      WHERE site_id = ANY(${activeSiteIds})
      GROUP BY site_id
    `) as unknown as { rows: Array<{ site_id: string; last_call: string | null }> };
    const callMap = new Map(
      (callRows.rows ?? []).map((r) => [r.site_id, r.last_call ? new Date(r.last_call) : null]),
    );

    for (const t of activeTenants) {
      const fromCalls = t.siteId ? (callMap.get(t.siteId) ?? null) : null;
      lastContactMap.set(t.id, fromCalls);
    }
  }

  const churnRiskCount = activeTenants.filter((t) => {
    const lc = lastContactMap.get(t.id);
    return !lc || lc < cutoff14d;
  }).length;

  const filtered =
    effectiveStatus === 'all'
      ? allTenants
      : allTenants.filter((t) => t.status === effectiveStatus);

  const statuses = ['active', 'trial', 'past_due', 'churned', 'all'];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Tenants</h1>
        <p className="text-sm text-slate-400 mt-1">Active rentals and billing status.</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="text-xs uppercase text-slate-500 tracking-wide">Active MRR</div>
          <div className="text-2xl font-semibold mt-1">{currency.format(activeMrr)}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="text-xs uppercase text-slate-500 tracking-wide">Active tenants</div>
          <div className="text-2xl font-semibold mt-1">{activeTenants.length}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <div className="text-xs uppercase text-slate-500 tracking-wide">Churn risk</div>
          <div className="text-2xl font-semibold mt-1 text-amber-300">{churnRiskCount}</div>
          <div className="text-xs text-slate-500 mt-0.5">no contact in 14d</div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {statuses.map((s) => (
          <Link
            key={s}
            href={`/operator/tenants?status=${s}`}
            className={`text-sm px-2 py-0.5 rounded ${
              effectiveStatus === s
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/20 p-6 text-sm text-slate-500">
          No tenants with status &quot;{effectiveStatus}&quot;.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-slate-800 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                <Th>Business</Th>
                <Th>Status</Th>
                <Th>MRR</Th>
                <Th>Last contact</Th>
                <Th>Site</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const lc = lastContactMap.get(t.id) ?? null;
                const isChurnRisk =
                  t.status === 'active' && (!lc || lc < cutoff14d);
                return (
                  <tr key={t.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-900/40">
                    <Td>
                      <Link
                        href={`/operator/tenants/${t.id}`}
                        className="text-sky-400 hover:text-sky-300"
                      >
                        {t.businessName}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {t.niche ?? '—'}{t.city ? ` / ${t.city}` : ''}
                      </div>
                    </Td>
                    <Td>
                      <TenantStatusBadge status={t.status} />
                    </Td>
                    <Td className="text-slate-300">
                      {t.monthlyRentUsd ? currency.format(Number(t.monthlyRentUsd)) : '—'}
                    </Td>
                    <Td className="text-slate-500 whitespace-nowrap">
                      {ageLabel(lc)}
                      {isChurnRisk && (
                        <span className="ml-2 text-xs bg-amber-900/40 text-amber-300 border border-amber-700/50 px-1.5 py-0.5 rounded">
                          risk
                        </span>
                      )}
                    </Td>
                    <Td>
                      {t.siteId ? (
                        <Link
                          href={`/operator/sites/${t.siteId}`}
                          className="text-xs text-sky-400 hover:text-sky-300 font-mono"
                        >
                          {t.siteId.slice(0, 8)}…
                        </Link>
                      ) : (
                        <span className="text-slate-600">—</span>
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
