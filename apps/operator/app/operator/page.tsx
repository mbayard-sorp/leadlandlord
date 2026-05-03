import { sql } from 'drizzle-orm';
import { getDb, sites, agentRuns, tenants } from '@leadlandlord/db';

export const dynamic = 'force-dynamic';

interface Kpi {
  label: string;
  value: string | number;
  hint?: string;
}

export default async function OperatorOverview() {
  const db = getDb();
  const [siteCount] = await db.execute(sql`SELECT COUNT(*)::int AS c FROM sites`).then(rowsArr);
  const [warming] = await db
    .execute(sql`SELECT COUNT(*)::int AS c FROM sites WHERE status = 'warming'`)
    .then(rowsArr);
  const [rented] = await db
    .execute(sql`SELECT COUNT(*)::int AS c FROM sites WHERE status = 'rented'`)
    .then(rowsArr);
  const [activeTenants] = await db
    .execute(sql`SELECT COUNT(*)::int AS c FROM tenants WHERE status = 'active'`)
    .then(rowsArr);
  const [todayRuns] = await db
    .execute(
      sql`SELECT COUNT(*)::int AS c, COALESCE(SUM(cost_usd), 0)::float AS cost FROM agent_runs WHERE started_at >= CURRENT_DATE`,
    )
    .then(rowsArr);
  const [mrr] = await db
    .execute(sql`SELECT COALESCE(SUM(mrr_usd), 0)::float AS mrr FROM sites`)
    .then(rowsArr);

  const kpis: Kpi[] = [
    { label: 'Sites', value: siteCount?.c ?? 0, hint: `${warming?.c ?? 0} warming · ${rented?.c ?? 0} rented` },
    { label: 'Active tenants', value: activeTenants?.c ?? 0 },
    { label: 'Portfolio MRR', value: `$${Number(mrr?.mrr ?? 0).toFixed(2)}` },
    {
      label: 'Agent runs today',
      value: todayRuns?.c ?? 0,
      hint: `$${Number(todayRuns?.cost ?? 0).toFixed(2)} LLM spend`,
    },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Overview</h1>
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
    </div>
  );
}

// Helper because drizzle's neon-http returns either { rows } or array depending on query shape.
function rowsArr(res: unknown): { c?: number; cost?: number; mrr?: number }[] {
  if (Array.isArray(res)) return res as { c?: number }[];
  if (typeof res === 'object' && res !== null && 'rows' in res) {
    return (res as { rows: { c?: number }[] }).rows;
  }
  return [];
}
// Suppress unused-import warning for tenants type re-export.
void tenants;
void sites;
void agentRuns;
