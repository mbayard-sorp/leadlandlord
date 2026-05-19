import { getDb, sql } from '@leadlandlord/db';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface NetworkRow {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  outboundCount: number;
  inboundCount: number;
  openRequestCount: number;
  lastPlacedAt: Date | null;
}

async function loadNetworks(): Promise<NetworkRow[]> {
  const db = getDb();

  type RawRow = {
    id: string;
    name: string;
    slug: string;
    member_count: string;
    outbound_count: string;
    inbound_count: string;
    open_request_count: string;
    last_placed_at: string | null;
  };

  const result = await db.execute(sql`
    SELECT
      n.id,
      n.name,
      n.slug,
      COUNT(DISTINCT snm.site_id)::text                                         AS member_count,
      COUNT(DISTINCT csl_out.id) FILTER (WHERE csl_out.source_site_id IS NOT NULL)::text
                                                                                AS outbound_count,
      COUNT(DISTINCT csl_in.id)  FILTER (WHERE csl_in.target_site_id  IS NOT NULL)::text
                                                                                AS inbound_count,
      COUNT(DISTINCT lr.id)      FILTER (WHERE lr.status = 'pending')::text     AS open_request_count,
      MAX(csl_out.placed_at)                                                    AS last_placed_at
    FROM networks n
    LEFT JOIN site_network_memberships snm ON snm.network_id = n.id
    LEFT JOIN cross_site_links csl_out     ON csl_out.source_site_id = snm.site_id
    LEFT JOIN cross_site_links csl_in      ON csl_in.target_site_id  = snm.site_id
    LEFT JOIN link_requests lr             ON lr.requesting_site_id  = snm.site_id
    GROUP BY n.id, n.name, n.slug
    ORDER BY n.name
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawRows = (Array.isArray(result) ? result : (result as any).rows) as RawRow[];

  return rawRows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    memberCount: parseInt(r.member_count ?? '0', 10),
    outboundCount: parseInt(r.outbound_count ?? '0', 10),
    inboundCount: parseInt(r.inbound_count ?? '0', 10),
    openRequestCount: parseInt(r.open_request_count ?? '0', 10),
    lastPlacedAt: r.last_placed_at ? new Date(r.last_placed_at) : null,
  }));
}

export default async function NetworksPage() {
  const rows = await loadNetworks();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Networks</h1>
        <p className="text-sm text-slate-400 mt-1">
          Cross-link networks and their placement stats.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/20 p-6 text-sm text-slate-500">
          No networks found. Seed one via the DB or run the network-linker agent.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-slate-800 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                <Th>Network</Th>
                <Th>Members</Th>
                <Th>Outbound links</Th>
                <Th>Inbound links</Th>
                <Th>Open requests</Th>
                <Th>Last placement</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-800/60 last:border-0">
                  <Td>
                    <div className="font-medium text-slate-200">{row.name}</div>
                    <div className="text-xs text-slate-500 font-mono">{row.slug}</div>
                  </Td>
                  <Td>{row.memberCount}</Td>
                  <Td>{row.outboundCount}</Td>
                  <Td>{row.inboundCount}</Td>
                  <Td>
                    {row.openRequestCount > 0 ? (
                      <span className="text-amber-300">{row.openRequestCount}</span>
                    ) : (
                      <span className="text-slate-500">0</span>
                    )}
                  </Td>
                  <Td className="text-slate-400 whitespace-nowrap">
                    {row.lastPlacedAt ? row.lastPlacedAt.toLocaleString() : <span className="text-slate-600">—</span>}
                  </Td>
                  <Td>
                    <Link
                      href="#"
                      title="Detail view coming Sprint 5"
                      className="text-xs text-slate-500 cursor-not-allowed"
                      aria-disabled
                    >
                      View (Sprint 5)
                    </Link>
                  </Td>
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
