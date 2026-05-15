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
} from '@leadlandlord/db';

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
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">Site / Network</p>
        <h1 className="text-xl md:text-2xl font-semibold mt-1">{siteLabel}</h1>
      </header>

      {/* Counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Outbound (30d)" value={outboundLast30} />
        <StatCard label="Inbound (30d)" value={inboundLast30} />
        <StatCard label="Total outbound" value={outboundLinks.length} />
        <StatCard label="Total inbound" value={inboundLinks.length} />
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
                      {new Date(m.joinedAt).toLocaleDateString()}
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
                      {l.placedAt ? new Date(l.placedAt).toLocaleString() : '—'}
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
                      {l.placedAt ? new Date(l.placedAt).toLocaleString() : '—'}
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
                      {new Date(r.scheduledFor).toLocaleString()}
                    </Td>
                    <Td className="text-slate-400 whitespace-nowrap text-xs">
                      {new Date(r.createdAt).toLocaleString()}
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

function StatCard({ label, value }: { label: string; value: number }) {
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
