import { asc, getDb, agentApprovals } from '@leadlandlord/db';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { ApprovalButtons } from './ApprovalButtons';
import { CrossLinkPlacementPreview } from './CrossLinkPlacementPreview';
import { WaveStateTransitionPreview } from './WaveStateTransitionPreview';

export const dynamic = 'force-dynamic';

type ApprovalRow = typeof agentApprovals.$inferSelect;

function payloadPreview(kind: string, payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;
  if (kind === 'niche_candidate') {
    return `${p.niche ?? '?'} / ${p.city ?? '?'}, ${p.state ?? '?'} — score ${p.score ?? '?'}`;
  }
  return JSON.stringify(payload).slice(0, 80);
}

function ageLabel(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime();
  const hrs = Math.floor(ms / 3600000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind: kindFilter } = await searchParams;
  const db = getDb();

  const rows: ApprovalRow[] = await db
    .select()
    .from(agentApprovals)
    .where(eq(agentApprovals.status, 'pending'))
    .orderBy(asc(agentApprovals.createdAt));

  const filtered = kindFilter ? rows.filter((r) => r.kind === kindFilter) : rows;

  const kinds = Array.from(new Set(rows.map((r) => r.kind))).sort();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Approvals inbox</h1>
        <p className="text-sm text-slate-400 mt-1">
          All pending agent actions requiring operator review, oldest first.
        </p>
      </header>

      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-400">Filter by kind:</span>
        <Link
          href="/operator/approvals"
          className={`text-sm px-2 py-0.5 rounded ${!kindFilter ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
        >
          All ({rows.length})
        </Link>
        {kinds.map((k) => (
          <Link
            key={k}
            href={`/operator/approvals?kind=${encodeURIComponent(k)}`}
            className={`text-sm px-2 py-0.5 rounded ${kindFilter === k ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {k} ({rows.filter((r) => r.kind === k).length})
          </Link>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/20 p-6 text-sm text-slate-500">
          No pending approvals{kindFilter ? ` for kind "${kindFilter}"` : ''}.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-slate-800 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                <Th>Kind</Th>
                <Th>Preview</Th>
                <Th>Age</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="border-b border-slate-800/60 last:border-0">
                  <Td>
                    <span className="font-mono text-xs bg-slate-800 px-1.5 py-0.5 rounded">
                      {row.kind}
                    </span>
                  </Td>
                  <Td className="max-w-sm text-slate-300">
                    {row.kind === 'cross_link_placement' ? (
                      <CrossLinkPlacementPreview payload={row.payload} />
                    ) : row.kind === 'wave_state_transition' ? (
                      <WaveStateTransitionPreview payload={row.payload} />
                    ) : (
                      <>
                        {payloadPreview(row.kind, row.payload)}
                        {row.kind === 'niche_candidate' && (
                          <div className="mt-0.5">
                            <Link
                              href="/operator/approvals/niches"
                              className="text-xs text-indigo-400 hover:underline"
                            >
                              View niche queue
                            </Link>
                          </div>
                        )}
                      </>
                    )}
                  </Td>
                  <Td className="text-slate-500 whitespace-nowrap">{ageLabel(row.createdAt)}</Td>
                  <Td>
                    <ApprovalButtons id={row.id} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-slate-600">
        <Link href="/operator/approvals/rules" className="hover:text-slate-400">
          Manage auto-approve rules
        </Link>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
