import { sql } from 'drizzle-orm';
import { unstable_cache } from 'next/cache';
import { getDb, getSystemState } from '@leadlandlord/db';
import { KillSwitchPanel } from './KillSwitchPanel';

// `force-dynamic` so the page never prerenders at build time. Drizzle SELECTs
// the full column set defined in the schema; a build that lands before the DB
// migration runs would throw "column does not exist" against a not-yet-migrated
// DB and abort the deploy. Run dynamically per request — by then, migrations
// have applied. Phase F added new columns to system_state.
export const dynamic = 'force-dynamic';

interface Kpi {
  label: string;
  value: string | number;
  hint?: string;
}

interface OverviewRow {
  total_sites: number;
  warming_sites: number;
  rented_sites: number;
  active_tenants: number;
  total_mrr: number;
  runs_today: number;
  cost_today: number;
}

const loadOverview = unstable_cache(
  async (): Promise<OverviewRow> => {
    const db = getDb();
    const result = await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM sites)                                                    AS total_sites,
        (SELECT COUNT(*)::int FROM sites WHERE status = 'warming')                           AS warming_sites,
        (SELECT COUNT(*)::int FROM sites WHERE status = 'rented')                            AS rented_sites,
        (SELECT COUNT(*)::int FROM tenants WHERE status = 'active')                          AS active_tenants,
        (SELECT COALESCE(SUM(mrr_usd), 0)::float FROM sites)                                 AS total_mrr,
        (SELECT COUNT(*)::int FROM agent_runs WHERE started_at >= CURRENT_DATE)              AS runs_today,
        (SELECT COALESCE(SUM(cost_usd), 0)::float FROM agent_runs WHERE started_at >= CURRENT_DATE) AS cost_today
    `);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (Array.isArray(result) ? result : (result as any).rows) as OverviewRow[];
    return rows[0] ?? {
      total_sites: 0,
      warming_sites: 0,
      rented_sites: 0,
      active_tenants: 0,
      total_mrr: 0,
      runs_today: 0,
      cost_today: 0,
    };
  },
  ['operator-overview'],
  { revalidate: 30, tags: ['overview'] },
);

export default async function OverviewPage() {
  const [row, systemStateRow] = await Promise.all([loadOverview(), getSystemState()]);

  const kpis: Kpi[] = [
    {
      label: 'Sites',
      value: row.total_sites,
      hint: `${row.warming_sites} warming · ${row.rented_sites} rented`,
    },
    { label: 'Active tenants', value: row.active_tenants },
    { label: 'Portfolio MRR', value: `$${row.total_mrr.toFixed(2)}` },
    {
      label: 'Agent runs today',
      value: row.runs_today,
      hint: `$${row.cost_today.toFixed(2)} LLM spend`,
    },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-slate-400 mt-1">Phase 1 KPIs. Pipeline + P&L wire up in Phase 4.</p>
      </header>
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{k.label}</p>
            <p className="text-2xl font-semibold mt-2">{k.value}</p>
            {k.hint && <p className="text-xs text-slate-500 mt-1">{k.hint}</p>}
          </div>
        ))}
      </section>
      <KillSwitchPanel state={systemStateRow} />
    </div>
  );
}
