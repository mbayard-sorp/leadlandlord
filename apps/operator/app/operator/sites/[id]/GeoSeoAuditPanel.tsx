import { desc, eq } from 'drizzle-orm';
import { getDb, geoSeoAudits, type GeoSeoAudit } from '@leadlandlord/db';
import { Timestamp } from '../../../../components/Timestamp';

const AUDITORS: Array<{ key: string; label: string }> = [
  { key: 'geo_aeo', label: 'GEO / AEO' },
  { key: 'local_seo', label: 'Local SEO' },
  { key: 'content_data', label: 'Content data' },
];

/**
 * Read-only mini-panel showing the latest GEO/SEO audit score per auditor plus
 * a tiny score history (last ~8 runs). Server-rendered; no charting lib.
 */
export async function GeoSeoAuditPanel({ siteId }: { siteId: string }) {
  const db = getDb();
  // Pull a generous recent window and group by auditor in app code — small
  // result set, simpler than a per-auditor windowed SQL query.
  const rows = await db
    .select()
    .from(geoSeoAudits)
    .where(eq(geoSeoAudits.siteId, siteId))
    .orderBy(desc(geoSeoAudits.auditedAt))
    .limit(60);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
        No GEO/SEO audits yet. The geo-aeo, local-seo, and content-data auditors populate this once they run for this site.
      </div>
    );
  }

  const byAuditor = new Map<string, GeoSeoAudit[]>();
  for (const r of rows) {
    const list = byAuditor.get(r.auditor) ?? [];
    list.push(r);
    byAuditor.set(r.auditor, list);
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {AUDITORS.map(({ key, label }) => {
        const audits = byAuditor.get(key) ?? [];
        const latest = audits[0] ?? null;
        // audits are newest-first; reverse the last ~8 so the sparkline reads left→right oldest→newest.
        const history = audits.slice(0, 8).reverse();
        return <AuditorCard key={key} label={label} latest={latest} history={history} />;
      })}
    </div>
  );
}

function AuditorCard({
  label,
  latest,
  history,
}: {
  label: string;
  latest: GeoSeoAudit | null;
  history: GeoSeoAudit[];
}) {
  if (!latest) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h4 className="text-xs uppercase tracking-wide text-slate-500">{label}</h4>
        <p className="mt-3 text-sm text-slate-600">No runs yet.</p>
      </div>
    );
  }
  const score = Number(latest.score);
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h4 className="text-xs uppercase tracking-wide text-slate-500">{label}</h4>
        <span className={`text-2xl font-semibold tabular-nums ${scoreTone(score)}`}>
          {Number.isFinite(score) ? score.toFixed(0) : '—'}
        </span>
      </div>
      <p className="text-[11px] text-slate-600">
        <Timestamp value={latest.auditedAt} />
        {latest.recommendationCount > 0 && (
          <span className="ml-2 text-amber-300/80">{latest.recommendationCount} rec{latest.recommendationCount === 1 ? '' : 's'}</span>
        )}
      </p>
      <Sparkline history={history} />
    </div>
  );
}

/** Bar-style sparkline of the last ~8 scores (0–100), rendered with divs. */
function Sparkline({ history }: { history: GeoSeoAudit[] }) {
  if (history.length < 2) {
    return <p className="text-[11px] text-slate-600">Not enough history for a trend.</p>;
  }
  return (
    <div className="flex items-end gap-0.5 h-10" aria-label="score history">
      {history.map((a) => {
        const v = Math.max(0, Math.min(100, Number(a.score) || 0));
        return (
          <div
            key={a.id}
            className={`flex-1 rounded-sm ${barTone(v)}`}
            style={{ height: `${Math.max(4, v)}%` }}
            title={`${v.toFixed(0)} — ${new Date(a.auditedAt).toLocaleDateString()}`}
          />
        );
      })}
    </div>
  );
}

function scoreTone(v: number): string {
  if (!Number.isFinite(v)) return 'text-slate-400';
  if (v >= 80) return 'text-emerald-300';
  if (v >= 50) return 'text-amber-300';
  return 'text-red-300';
}

function barTone(v: number): string {
  if (v >= 80) return 'bg-emerald-500/70';
  if (v >= 50) return 'bg-amber-500/70';
  return 'bg-red-500/70';
}
