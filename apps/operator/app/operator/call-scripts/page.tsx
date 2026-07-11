import { asc } from 'drizzle-orm';
import { getDb, callQualificationScripts } from '@leadlandlord/db';
import { ScriptForm } from './ScriptForm';

export const dynamic = 'force-dynamic';

export default async function CallScriptsPage() {
  const db = getDb();
  const rows = await db
    .select()
    .from(callQualificationScripts)
    .orderBy(asc(callQualificationScripts.niche));

  // Postgres sorts NULL last with asc() by default, but be explicit about
  // showing the default (niche IS NULL) row first — it's the fallback every
  // AI-answered call resolves to absent a niche-specific match.
  const defaultRow = rows.find((r) => r.niche === null) ?? null;
  const nicheRows = rows.filter((r) => r.niche !== null);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Call qualification scripts</h1>
        <p className="text-sm text-slate-400 mt-1">
          Niche-keyed question scripts for the shared ElevenLabs Conversational AI agent (ADR
          0031). The single row with no niche is the default fallback used whenever a site's
          niche has no dedicated script.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Default (all niches)
        </h2>
        <ScriptForm script={defaultRow} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Niche-specific scripts ({nicheRows.length})
        </h2>
        {nicheRows.length === 0 ? (
          <p className="text-sm text-slate-500">
            No niche-specific scripts yet — every site uses the default above.
          </p>
        ) : (
          <div className="space-y-4">
            {nicheRows.map((row) => (
              <ScriptForm key={row.id} script={row} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Add a niche-specific script
        </h2>
        <ScriptForm script={null} />
      </section>
    </div>
  );
}
