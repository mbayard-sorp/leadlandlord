import { asc, getDb, agentApprovals } from '@leadlandlord/db';
import { eq, and } from 'drizzle-orm';
import Link from 'next/link';
import { ApprovalButtons } from '../ApprovalButtons';

export const dynamic = 'force-dynamic';

type ApprovalRow = typeof agentApprovals.$inferSelect;

interface NichePayload {
  nicheId?: string;
  niche?: string;
  city?: string;
  state?: string;
  score?: number;
  searchVolume?: number;
  kd?: number;
  adCount?: number;
  estAvgJobValueUsd?: number;
  estCloseRate?: number;
  rationale?: string;
}

function toPayload(raw: unknown): NichePayload {
  return (raw ?? {}) as NichePayload;
}

function ageLabel(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime();
  const hrs = Math.floor(ms / 3600000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function NicheApprovalsPage() {
  const db = getDb();

  const rows: ApprovalRow[] = await db
    .select()
    .from(agentApprovals)
    .where(and(eq(agentApprovals.kind, 'niche_candidate'), eq(agentApprovals.status, 'pending')))
    .orderBy(asc(agentApprovals.createdAt));

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-3">
          <h1 className="text-xl md:text-2xl font-semibold">Niche approvals</h1>
          <Link
            href="/operator/niches"
            className="text-xs text-slate-400 hover:text-slate-200 border border-slate-700 px-2 py-0.5 rounded"
          >
            Legacy niches view
          </Link>
        </div>
        <p className="text-sm text-slate-400 mt-1">
          Pending niche candidates from Niche Hunter, awaiting operator decision.{' '}
          <Link href="/operator/approvals/rules" className="text-indigo-400 hover:underline">
            Manage auto-approve rules
          </Link>
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/20 p-6 text-sm text-slate-500">
          No pending niche approvals. Run Niche Hunter from{' '}
          <Link href="/operator/niches" className="text-indigo-400 hover:underline">
            /operator/niches
          </Link>{' '}
          to populate.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-slate-800 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                <Th>Niche</Th>
                <Th className="hidden md:table-cell">City</Th>
                <Th>Score</Th>
                <Th className="hidden md:table-cell">Vol</Th>
                <Th className="hidden md:table-cell">KD</Th>
                <Th className="hidden lg:table-cell">Ads</Th>
                <Th className="hidden lg:table-cell">Job $</Th>
                <Th className="hidden lg:table-cell">Rationale</Th>
                <Th>Age</Th>
                <Th>Decision</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const p = toPayload(row.payload);
                return (
                  <tr key={row.id} className="border-b border-slate-800/60 last:border-0">
                    <Td className="break-words font-medium">
                      {p.niche ?? '—'}
                      <div className="text-xs text-slate-500 md:hidden">
                        {p.city}, {p.state}
                      </div>
                    </Td>
                    <Td className="hidden md:table-cell">
                      {p.city}, {p.state}
                    </Td>
                    <Td className="font-semibold">{p.score?.toFixed(1) ?? '—'}</Td>
                    <Td className="hidden md:table-cell">{p.searchVolume ?? '—'}</Td>
                    <Td className="hidden md:table-cell">{p.kd ?? '—'}</Td>
                    <Td className="hidden lg:table-cell">{p.adCount ?? '—'}</Td>
                    <Td className="hidden lg:table-cell">
                      {p.estAvgJobValueUsd != null ? `$${p.estAvgJobValueUsd}` : '—'}
                    </Td>
                    <Td className="text-xs text-slate-400 max-w-xs hidden lg:table-cell">
                      {p.rationale ?? '—'}
                    </Td>
                    <Td className="text-slate-500 whitespace-nowrap">{ageLabel(row.createdAt)}</Td>
                    <Td>
                      <div className="flex flex-col gap-1.5">
                        <ApprovalButtons id={row.id} />
                        <Link
                          href={`/operator/approvals/rules?kind=niche_candidate&score_gte=${Math.floor(p.score ?? 0)}`}
                          className="text-xs text-indigo-400 hover:underline whitespace-nowrap"
                        >
                          Auto-approve rule
                        </Link>
                      </div>
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

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
