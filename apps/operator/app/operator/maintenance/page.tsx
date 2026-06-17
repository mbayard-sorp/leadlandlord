import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, maintenanceFindings, sites, type MaintenanceFinding, type Site } from '@leadlandlord/db';
import { resolveFinding, ignoreFinding } from './_actions';
import { Timestamp } from '../../../components/Timestamp';

export const revalidate = 30;

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

interface PageProps {
  searchParams?: Promise<{ siteId?: string }>;
}

export default async function MaintenancePage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const filterSiteId = params.siteId;

  const db = getDb();
  const allFindings: MaintenanceFinding[] = filterSiteId
    ? await db
        .select()
        .from(maintenanceFindings)
        .where(
          and(eq(maintenanceFindings.status, 'open'), eq(maintenanceFindings.siteId, filterSiteId)),
        )
        .orderBy(desc(maintenanceFindings.detectedAt))
    : await db
        .select()
        .from(maintenanceFindings)
        .where(eq(maintenanceFindings.status, 'open'))
        .orderBy(desc(maintenanceFindings.detectedAt));

  const allSites: Site[] = await db.select().from(sites);
  const siteById = new Map(allSites.map((s) => [s.id, s]));

  // Group by category
  const byCategory = new Map<string, MaintenanceFinding[]>();
  for (const f of allFindings) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }
  const sortedCategories = [...byCategory.entries()].sort((a, b) => {
    const aMin = Math.min(...a[1].map((f) => SEVERITY_ORDER[f.severity] ?? 9));
    const bMin = Math.min(...b[1].map((f) => SEVERITY_ORDER[f.severity] ?? 9));
    return aMin - bMin;
  });

  const totalBySev = { critical: 0, warning: 0, info: 0 };
  for (const f of allFindings) {
    if (f.severity === 'critical') totalBySev.critical += 1;
    else if (f.severity === 'warning') totalBySev.warning += 1;
    else if (f.severity === 'info') totalBySev.info += 1;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Maintenance findings</h1>
        <p className="text-sm text-slate-400 mt-1">
          Open findings from the daily maintenance agent. Resolve when fixed; ignore to suppress.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 text-xs">
        <SeverityChip severity="critical" count={totalBySev.critical} />
        <SeverityChip severity="warning" count={totalBySev.warning} />
        <SeverityChip severity="info" count={totalBySev.info} />
        {filterSiteId && (
          <Link
            href="/operator/maintenance"
            className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:bg-slate-800"
          >
            Clear site filter
          </Link>
        )}
      </div>

      {!filterSiteId && (
        <SiteFilter sites={allSites} />
      )}

      {allFindings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
          No open findings. Nice.
        </div>
      ) : (
        sortedCategories.map(([category, findings]) => (
          <section key={category} className="rounded-lg border border-slate-800 overflow-hidden">
            <header className="bg-slate-900/60 px-3 py-2 text-xs uppercase tracking-wide text-slate-400 flex items-center justify-between">
              <span>{categoryLabel(category)}</span>
              <span>{findings.length} open</span>
            </header>
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Severity</th>
                  <th className="text-left px-3 py-2">Site</th>
                  <th className="text-left px-3 py-2">Detail</th>
                  <th className="text-left px-3 py-2">Detected</th>
                  <th className="text-right px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {findings.map((f) => {
                  const site = f.siteId ? siteById.get(f.siteId) : null;
                  return (
                    <tr key={f.id}>
                      <td className="px-3 py-2">
                        <SeverityBadge severity={f.severity} />
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {site ? (
                          <Link
                            href={`/operator/sites/${site.id}`}
                            className="text-sky-400 hover:text-sky-300"
                          >
                            {site.niche} {site.city}
                          </Link>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-300">{f.detail}</td>
                      <td className="px-3 py-2 text-slate-500 text-xs">
                        <Timestamp value={f.detectedAt} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-2">
                          <form action={resolveFinding}>
                            <input type="hidden" name="id" value={f.id} />
                            <button
                              type="submit"
                              className="text-xs rounded border border-emerald-700/50 bg-emerald-900/20 px-2 py-0.5 text-emerald-300 hover:bg-emerald-900/40"
                            >
                              Resolve
                            </button>
                          </form>
                          <form action={ignoreFinding}>
                            <input type="hidden" name="id" value={f.id} />
                            <button
                              type="submit"
                              className="text-xs rounded border border-slate-700 bg-slate-800/40 px-2 py-0.5 text-slate-300 hover:bg-slate-800"
                            >
                              Ignore
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}

function SeverityChip({ severity, count }: { severity: string; count: number }) {
  const tone =
    severity === 'critical'
      ? 'bg-rose-900/40 text-rose-300 border-rose-700/50'
      : severity === 'warning'
      ? 'bg-amber-900/30 text-amber-300 border-amber-700/50'
      : 'bg-slate-800 text-slate-300 border-slate-700';
  return (
    <span className={`inline-block rounded border px-2 py-0.5 ${tone}`}>
      {severity}: {count}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const tone =
    severity === 'critical'
      ? 'bg-rose-900/40 text-rose-300 border-rose-700/50'
      : severity === 'warning'
      ? 'bg-amber-900/30 text-amber-300 border-amber-700/50'
      : 'bg-slate-800 text-slate-300 border-slate-700';
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs ${tone}`}>{severity}</span>
  );
}

function categoryLabel(c: string): string {
  switch (c) {
    case 'ssl_expiry':
      return 'SSL expiry';
    case 'domain_expiry':
      return 'Domain expiry';
    case 'deploy_failure':
      return 'Vercel deploy failures';
    case 'broken_link':
      return 'Broken links';
    case 'no_tracking':
      return 'Missing tracking number';
    case 'no_calls_30d':
      return 'No calls in 30d';
    case 'ga4_traffic_drop':
      return 'GA4 traffic drop';
    default:
      return c;
  }
}

function SiteFilter({ sites }: { sites: Site[] }) {
  if (sites.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
        Filter by site
      </summary>
      <div className="mt-2 flex flex-wrap gap-2">
        {sites.slice(0, 50).map((s) => (
          <Link
            key={s.id}
            href={`/operator/maintenance?siteId=${s.id}`}
            className="rounded border border-slate-700 bg-slate-900/40 px-2 py-0.5 text-slate-300 hover:bg-slate-800"
          >
            {s.niche} {s.city}
          </Link>
        ))}
      </div>
    </details>
  );
}
