import { notFound } from 'next/navigation';
import {
  getDb,
  sites,
  networks,
  siteNetworkMemberships,
  crossSiteLinks,
  linkRequests,
  eq,
  inArray,
  and,
  sql,
  isCrossLinkPaused,
} from '@leadlandlord/db';
import { Timestamp } from '../../../../../components/Timestamp';
import { RequestLinksButton } from './RequestLinksButton';

interface NetworkLinkerRunRow {
  id: string;
  status: string;
  output: { linksPlaced?: number; candidatesEvaluated?: number; hygieneFailed?: number; llmSkipped?: number } | null;
  error: string | null;
  started_at: string | Date;
  ended_at: string | Date | null;
}

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export default async function SiteNetworkPage({ params }: Params) {
  const { id } = await params;
  const db = getDb();

  // Verify site exists
  const siteRow = (await db.select({ id: sites.id, niche: sites.niche, city: sites.city, state: sites.state }).from(sites).where(eq(sites.id, id)).limit(1))[0];
  if (!siteRow) notFound();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [memberships, outboundLinks, inboundLinks, openRequests] = await Promise.all([
    // Network memberships
    db
      .select({
        networkId: siteNetworkMemberships.networkId,
        networkName: networks.name,
        networkSlug: networks.slug,
        linkBudgetOutbound: siteNetworkMemberships.linkBudgetOutbound,
        linkBudgetInbound: siteNetworkMemberships.linkBudgetInbound,
        status: siteNetworkMemberships.status,
        joinedAt: siteNetworkMemberships.joinedAt,
      })
      .from(siteNetworkMemberships)
      .innerJoin(networks, eq(networks.id, siteNetworkMemberships.networkId))
      .where(eq(siteNetworkMemberships.siteId, id)),

    // Outbound cross-site links
    db
      .select({
        id: crossSiteLinks.id,
        targetSiteId: crossSiteLinks.targetSiteId,
        targetUrl: crossSiteLinks.targetUrl,
        anchorText: crossSiteLinks.anchorText,
        placedAt: crossSiteLinks.placedAt,
        verifiedAt: crossSiteLinks.verifiedAt,
        status: crossSiteLinks.status,
      })
      .from(crossSiteLinks)
      .where(eq(crossSiteLinks.sourceSiteId, id))
      .orderBy(crossSiteLinks.placedAt),

    // Inbound cross-site links
    db
      .select({
        id: crossSiteLinks.id,
        sourceSiteId: crossSiteLinks.sourceSiteId,
        sourcePageId: crossSiteLinks.sourcePageId,
        anchorText: crossSiteLinks.anchorText,
        placedAt: crossSiteLinks.placedAt,
        status: crossSiteLinks.status,
      })
      .from(crossSiteLinks)
      .where(eq(crossSiteLinks.targetSiteId, id))
      .orderBy(crossSiteLinks.placedAt),

    // Open link requests
    db
      .select()
      .from(linkRequests)
      .where(and(eq(linkRequests.requestingSiteId, id), eq(linkRequests.status, 'pending'))),
  ]);

  // Recent network-linker runs scoped to this site: either stamped with the
  // site id, run in siteId-mode, or draining a link request for this site.
  const runRowsRaw = (await db.execute(sql`
    SELECT ar.id, ar.status, ar.output, ar.error, ar.started_at, ar.ended_at
    FROM agent_runs ar
    WHERE ar.agent = 'network-linker'
      AND (
        ar.site_id = ${id}
        OR ar.input->>'siteId' = ${id}
        OR EXISTS (
          SELECT 1 FROM link_requests lr
          WHERE lr.id::text = ar.input->>'linkRequestId'
            AND lr.requesting_site_id = ${id}
        )
      )
    ORDER BY ar.started_at DESC
    LIMIT 10
  `)) as unknown as { rows: NetworkLinkerRunRow[] } | NetworkLinkerRunRow[];
  const recentRuns = Array.isArray(runRowsRaw) ? runRowsRaw : runRowsRaw.rows;

  const crossLinkPaused = await isCrossLinkPaused();

  const activeOutbound = outboundLinks.filter((l) => l.status === 'active');
  const verifiedOutbound = activeOutbound.filter((l) => l.verifiedAt).length;

  // Resolve site names for outbound targets and inbound sources
  const outboundTargetIds = [...new Set(outboundLinks.map((l) => l.targetSiteId))];
  const inboundSourceIds = [...new Set(inboundLinks.map((l) => l.sourceSiteId))];
  const relatedIds = [...new Set([...outboundTargetIds, ...inboundSourceIds])];

  const relatedSites =
    relatedIds.length > 0
      ? await db
          .select({ id: sites.id, niche: sites.niche, city: sites.city, state: sites.state })
          .from(sites)
          .where(inArray(sites.id, relatedIds))
      : [];

  const siteMap = Object.fromEntries(
    relatedSites.map((s) => [s.id, `${s.niche} — ${s.city}, ${s.state}`]),
  );

  const outboundLast30 = outboundLinks.filter(
    (l) => l.placedAt && new Date(l.placedAt) >= thirtyDaysAgo,
  ).length;
  const inboundLast30 = inboundLinks.filter(
    (l) => l.placedAt && new Date(l.placedAt) >= thirtyDaysAgo,
  ).length;

  const siteLabel = `${siteRow.niche} — ${siteRow.city}, ${siteRow.state}`;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Site / Network</p>
          <h1 className="text-xl md:text-2xl font-semibold mt-1">{siteLabel}</h1>
        </div>
        <RequestLinksButton siteId={id} disabled={crossLinkPaused} />
      </header>

      {crossLinkPaused && (
        <div className="rounded-lg border border-amber-700/50 bg-amber-900/30 px-4 py-3 text-sm text-amber-200">
          Network cross-links are paused. No links are injected on live pages and
          the request seeder is idle.
        </div>
      )}

      {/* Counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Outbound (30d)" value={outboundLast30} />
        <StatCard label="Inbound (30d)" value={inboundLast30} />
        <StatCard label="Active outbound" value={activeOutbound.length} />
        <StatCard
          label="Verified live"
          value={`${verifiedOutbound}/${activeOutbound.length}`}
        />
      </div>

      {/* Network memberships */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Network memberships
        </h2>
        {memberships.length === 0 ? (
          <Empty>This site is not a member of any network.</Empty>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                  <Th>Network</Th>
                  <Th>Status</Th>
                  <Th>Budget out</Th>
                  <Th>Budget in</Th>
                  <Th>Joined</Th>
                </tr>
              </thead>
              <tbody>
                {memberships.map((m) => (
                  <tr key={m.networkId} className="border-b border-slate-800/60 last:border-0">
                    <Td>
                      <div className="font-medium text-slate-200">{m.networkName}</div>
                      <div className="text-xs text-slate-500 font-mono">{m.networkSlug}</div>
                    </Td>
                    <Td>
                      <StatusPill status={m.status} />
                    </Td>
                    <Td>{m.linkBudgetOutbound}</Td>
                    <Td>{m.linkBudgetInbound}</Td>
                    <Td className="text-slate-400 whitespace-nowrap">
                      <Timestamp value={m.joinedAt} mode="date" />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Outbound links */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Outbound links ({outboundLinks.length})
        </h2>
        {outboundLinks.length === 0 ? (
          <Empty>No outbound cross-site links placed yet.</Empty>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                  <Th>Target site</Th>
                  <Th>Target URL</Th>
                  <Th>Anchor</Th>
                  <Th>Placed</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {outboundLinks.map((l) => (
                  <tr key={l.id} className="border-b border-slate-800/60 last:border-0">
                    <Td className="text-slate-300">{siteMap[l.targetSiteId] ?? l.targetSiteId}</Td>
                    <Td>
                      <a
                        href={l.targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-400 hover:text-sky-300 text-xs break-all"
                      >
                        {l.targetUrl} ↗
                      </a>
                    </Td>
                    <Td>
                      <code className="text-xs bg-slate-800 px-1 rounded">{l.anchorText}</code>
                    </Td>
                    <Td className="text-slate-400 whitespace-nowrap text-xs">
                      {l.placedAt ? <Timestamp value={l.placedAt} /> : '—'}
                    </Td>
                    <Td>
                      <StatusPill status={l.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Inbound links */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Inbound links ({inboundLinks.length})
        </h2>
        {inboundLinks.length === 0 ? (
          <Empty>No inbound cross-site links yet.</Empty>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                  <Th>Source site</Th>
                  <Th>Source page</Th>
                  <Th>Anchor</Th>
                  <Th>Placed</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {inboundLinks.map((l) => (
                  <tr key={l.id} className="border-b border-slate-800/60 last:border-0">
                    <Td className="text-slate-300">{siteMap[l.sourceSiteId] ?? l.sourceSiteId}</Td>
                    <Td>
                      <code className="text-xs bg-slate-800 px-1 rounded">{l.sourcePageId}</code>
                    </Td>
                    <Td>
                      <code className="text-xs bg-slate-800 px-1 rounded">{l.anchorText}</code>
                    </Td>
                    <Td className="text-slate-400 whitespace-nowrap text-xs">
                      {l.placedAt ? <Timestamp value={l.placedAt} /> : '—'}
                    </Td>
                    <Td>
                      <StatusPill status={l.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Open link requests */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Open link requests ({openRequests.length})
        </h2>
        {openRequests.length === 0 ? (
          <Empty>No pending link requests.</Empty>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                  <Th>Status</Th>
                  <Th>Desired count</Th>
                  <Th>Scheduled for</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody>
                {openRequests.map((r) => (
                  <tr key={r.id} className="border-b border-slate-800/60 last:border-0">
                    <Td>
                      <StatusPill status={r.status} />
                    </Td>
                    <Td>{r.desiredCount}</Td>
                    <Td className="text-slate-400 whitespace-nowrap text-xs">
                      <Timestamp value={r.scheduledFor} />
                    </Td>
                    <Td className="text-slate-400 whitespace-nowrap text-xs">
                      <Timestamp value={r.createdAt} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Network-linker activity */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Network-linker activity
        </h2>
        {recentRuns.length === 0 ? (
          <Empty>No network-linker runs for this site yet.</Empty>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                  <Th>Status</Th>
                  <Th>Placed</Th>
                  <Th>Evaluated</Th>
                  <Th>Hygiene fail</Th>
                  <Th>LLM skip</Th>
                  <Th>Started</Th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id} className="border-b border-slate-800/60 last:border-0">
                    <Td>
                      <StatusPill status={r.status} />
                      {r.error && (
                        <div className="text-xs text-red-400 mt-1 max-w-xs truncate" title={r.error}>
                          {r.error}
                        </div>
                      )}
                    </Td>
                    <Td className="text-slate-200 font-medium">{r.output?.linksPlaced ?? '—'}</Td>
                    <Td className="text-slate-400">{r.output?.candidatesEvaluated ?? '—'}</Td>
                    <Td className="text-slate-400">{r.output?.hygieneFailed ?? '—'}</Td>
                    <Td className="text-slate-400">{r.output?.llmSkipped ?? '—'}</Td>
                    <Td className="text-slate-400 whitespace-nowrap text-xs">
                      <Timestamp value={r.started_at} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-2xl font-semibold text-slate-100">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'active' || status === 'completed'
      ? 'text-emerald-300 border-emerald-700/50 bg-emerald-900/30'
      : status === 'removed' || status === 'broken' || status === 'cancelled'
      ? 'text-red-300 border-red-700/50 bg-red-900/30'
      : status === 'paused' || status === 'quarantined' || status === 'processing'
      ? 'text-amber-300 border-amber-700/50 bg-amber-900/30'
      : 'text-slate-400 border-slate-700 bg-slate-800/60';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{status}</span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}
