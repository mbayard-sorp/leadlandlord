import { desc } from 'drizzle-orm';
import { getDb, niches } from '@leadlandlord/db';
import { RunForm } from './RunForm';
import { DecisionButtons } from './DecisionButtons';

export const dynamic = 'force-dynamic';

export default async function NichesPage() {
  const db = getDb();
  const rows = await db.select().from(niches).orderBy(desc(niches.score)).limit(200);

  const pending = rows.filter((r) => r.decision === 'pending');
  const approved = rows.filter((r) => r.decision === 'approved' || r.decision === 'approved_dry_run');
  const rejected = rows.filter((r) => r.decision === 'rejected');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Niches</h1>
        <p className="text-sm text-slate-400 mt-1">
          Niche Hunter brainstorms candidates with Claude, scores each with DataForSEO real
          search volume + keyword difficulty, ranks them. Approve a niche to dispatch Site
          Builder via the agent_events queue.
        </p>
      </header>

      <RunForm />

      <Section title={`Pending review (${pending.length})`}>
        {pending.length === 0 ? (
          <Empty>Nothing pending. Run Niche Hunter above to populate.</Empty>
        ) : (
          <Table rows={pending} showButtons />
        )}
      </Section>

      <Section title={`Approved (${approved.length})`} muted>
        {approved.length === 0 ? <Empty>No approved niches yet.</Empty> : <Table rows={approved} />}
      </Section>

      <Section title={`Rejected (${rejected.length})`} muted>
        {rejected.length === 0 ? <Empty>No rejected niches yet.</Empty> : <Table rows={rejected} />}
      </Section>
    </div>
  );
}

function Section({
  title,
  muted,
  children,
}: {
  title: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className={`text-sm font-semibold uppercase tracking-wide mb-2 ${muted ? 'text-slate-500' : 'text-slate-300'}`}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/20 p-4 text-sm text-slate-500">
      {children}
    </div>
  );
}

function Table({
  rows,
  showButtons = false,
}: {
  rows: Array<{
    id: string;
    niche: string;
    city: string;
    state: string;
    searchVolume: number | null;
    kd: number | null;
    estAvgJobValueUsd: string | null;
    estCloseRate: string | null;
    score: string | null;
    rationale: string | null;
  }>;
  showButtons?: boolean;
}) {
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-slate-800 bg-slate-900/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
            <Th>Niche</Th>
            <Th className="hidden md:table-cell">City</Th>
            <Th>Score</Th>
            <Th className="hidden md:table-cell">Vol</Th>
            <Th className="hidden md:table-cell">KD</Th>
            <Th className="hidden lg:table-cell">Job $</Th>
            <Th className="hidden lg:table-cell">Close</Th>
            <Th className="hidden lg:table-cell">Rationale</Th>
            {showButtons && <Th>Decision</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-slate-800/60 last:border-0">
              <Td className="break-words">
                {r.niche}
                <div className="text-xs text-slate-500 md:hidden">{r.city}, {r.state}</div>
              </Td>
              <Td className="hidden md:table-cell">{r.city}, {r.state}</Td>
              <Td className="font-semibold">{r.score ?? '—'}</Td>
              <Td className="hidden md:table-cell">{r.searchVolume ?? '—'}</Td>
              <Td className="hidden md:table-cell">{r.kd ?? '—'}</Td>
              <Td className="hidden lg:table-cell">${r.estAvgJobValueUsd ?? '—'}</Td>
              <Td className="hidden lg:table-cell">{r.estCloseRate ? `${(Number(r.estCloseRate) * 100).toFixed(0)}%` : '—'}</Td>
              <Td className="text-xs text-slate-400 max-w-md hidden lg:table-cell">{r.rationale}</Td>
              {showButtons && (
                <Td>
                  <DecisionButtons id={r.id} />
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
