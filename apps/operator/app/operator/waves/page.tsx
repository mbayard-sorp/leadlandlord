import { getDb, waves, sql } from '@leadlandlord/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

type WaveRow = {
  id: string;
  name: string;
  niche: string;
  state: string;
  siteCount: number;
  createdAt: Date;
  updatedAt: Date;
};

const STATE_COLORS: Record<string, string> = {
  draft: 'bg-slate-700 text-slate-300',
  launching: 'bg-blue-900/60 text-blue-300',
  aging: 'bg-amber-900/60 text-amber-300',
  linking: 'bg-violet-900/60 text-violet-300',
  backlinking: 'bg-indigo-900/60 text-indigo-300',
  monitoring: 'bg-teal-900/60 text-teal-300',
  completed: 'bg-emerald-900/60 text-emerald-300',
};

function relativeTime(date: Date): string {
  const ms = Date.now() - new Date(date).getTime();
  const hrs = Math.floor(ms / 3_600_000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function loadWaves(): Promise<WaveRow[]> {
  const db = getDb();

  type RawRow = {
    id: string;
    name: string;
    niche: string;
    state: string;
    site_count: string;
    created_at: string;
    updated_at: string;
  };

  const result = await db.execute(sql`
    SELECT
      id,
      name,
      niche,
      state,
      array_length(site_ids, 1)::text AS site_count,
      created_at,
      updated_at
    FROM waves
    ORDER BY created_at DESC
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawRows = (Array.isArray(result) ? result : (result as any).rows) as RawRow[];

  return rawRows.map((r) => ({
    id: r.id,
    name: r.name,
    niche: r.niche,
    state: r.state,
    siteCount: parseInt(r.site_count ?? '0', 10),
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  }));
}

export default async function WavesPage() {
  const rows = await loadWaves();

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">Waves</h1>
          <p className="text-sm text-slate-400 mt-1">
            Coordinated site launches and their pipeline state.
          </p>
        </div>
        <Link
          href="/operator/waves/new"
          className="text-sm bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded whitespace-nowrap"
        >
          New wave
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/20 p-6 text-sm text-slate-500">
          No waves yet.{' '}
          <Link href="/operator/waves/new" className="text-indigo-400 hover:underline">
            Create one
          </Link>{' '}
          to start a coordinated site launch.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-slate-800 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                <Th>Name</Th>
                <Th>Niche</Th>
                <Th>State</Th>
                <Th>Sites</Th>
                <Th>Created</Th>
                <Th>Last transition</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-800/60 last:border-0">
                  <Td>
                    <Link
                      href={`/operator/waves/${row.id}`}
                      className="font-medium text-slate-200 hover:text-indigo-300"
                    >
                      {row.name}
                    </Link>
                  </Td>
                  <Td className="text-slate-400">{row.niche}</Td>
                  <Td>
                    <span
                      className={`inline-block text-xs px-2 py-0.5 rounded font-medium ${STATE_COLORS[row.state] ?? 'bg-slate-700 text-slate-300'}`}
                    >
                      {row.state}
                    </span>
                  </Td>
                  <Td>{row.siteCount}</Td>
                  <Td className="text-slate-500 whitespace-nowrap">{relativeTime(row.createdAt)}</Td>
                  <Td className="text-slate-500 whitespace-nowrap">{relativeTime(row.updatedAt)}</Td>
                </tr>
              ))}
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
