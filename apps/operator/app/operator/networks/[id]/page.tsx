import { notFound } from 'next/navigation';
import {
  getDb,
  networks,
  sites,
  siteNetworkMemberships,
  crossSiteLinks,
  linkRequests,
  eq,
  inArray,
  and,
  sql,
  isCrossLinkPaused,
} from '@leadlandlord/db';
import { Timestamp } from '../../../../components/Timestamp';
import { CrossLinkPauseToggle } from '../CrossLinkPauseToggle';
import { loadNetworkRoi } from '../../../../lib/cross-link-roi';
import { scoreNetworkFootprint } from '@leadlandlord/agents';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

interface NetworkLinkerRunRow {
  id: string;
  status: string;
  output: { linksPlaced?: number; candidatesEvaluated?: number; hygieneFailed?: number; llmSkipped?: number } | null;
  error: string | null;
  started_at: string | Date;
}

export default async function NetworkDetailPage({ params }: Params) {
  const { id } = await params;
  const db = getDb();

  // 1. Load the network row; 404 if it doesn't exist.
  const networkRow = (
    await db
      .select({ id: networks.id, name: networks.name, slug: networks.slug, createdAt: networks.createdAt })
      .from(networks)
      .where(eq(networks.id, id))
      .limit(1)
  )[0];
  if (!networkRow) notFound();

  // 2. Members: siteNetworkMemberships JOIN sites for this network.
  const members = await db
    .select({
      membershipId: siteNetworkMemberships.id,
      siteId: siteNetworkMemberships.siteId,
      status: siteNetworkMemberships.status,
      linkBudgetOutbound: siteNetworkMemberships.linkBudgetOutbound,
      linkBudgetInbound: siteNetworkMemberships.linkBudgetInbound,
      joinedAt: siteNetworkMemberships.joinedAt,
      siteNiche: sites.niche,
      siteCity: sites.city,
      siteState: sites.state,
      siteStatus: sites.status,
    })
    .from(siteNetworkMemberships)
    .innerJoin(sites, eq(sites.id, siteNetworkMemberships.siteId))
    .where(eq(siteNetworkMemberships.networkId, id));

  const memberIds = members.map((m) => m.siteId);

  // Build a label map from member ids — reused across tables.
  const memberLabelMap = Object.fromEntries(
    members.map((m) => [m.siteId, `${m.siteNiche} — ${m.siteCity}, ${m.siteState}`]),
  );

  // 3. Recent cross-links where sourceSiteId IN memberIds (limit 50, newest first).
  const recentLinks =
    memberIds.length > 0
      ? await db
          .select({
            id: crossSiteLinks.id,
            sourceSiteId: crossSiteLinks.sourceSiteId,
            targetSiteId: crossSiteLinks.targetSiteId,
            anchorText: crossSiteLinks.anchorText,
            targetUrl: crossSiteLinks.targetUrl,
            placedAt: crossSiteLinks.placedAt,
            verifiedAt: crossSiteLinks.verifiedAt,
            status: crossSiteLinks.status,
          })
          .from(crossSiteLinks)
          .where(inArray(crossSiteLinks.sourceSiteId, memberIds))
          .orderBy(sql`${crossSiteLinks.placedAt} DESC NULLS LAST`)
          .limit(50)
      : [];

  // Resolve any non-member target site labels.
  const targetIds = [...new Set(recentLinks.map((l) => l.targetSiteId).filter((tid) => !memberLabelMap[tid]))];
  const extraSites =
    targetIds.length > 0
      ? await db
          .select({ id: sites.id, niche: sites.niche, city: sites.city, state: sites.state })
          .from(sites)
          .where(inArray(sites.id, targetIds))
      : [];
  const siteLabelMap: Record<string, string> = {
    ...memberLabelMap,
    ...Object.fromEntries(extraSites.map((s) => [s.id, `${s.niche} — ${s.city}, ${s.state}`])),
  };

  // 4. Pending link requests where requestingSiteId IN memberIds.
  const pendingRequests =
    memberIds.length > 0
      ? await db
          .select()
          .from(linkRequests)
          .where(and(inArray(linkRequests.requestingSiteId, memberIds), eq(linkRequests.status, 'pending')))
      : [];

  // 5. Recent network-linker runs scoped to member sites.
  let recentRuns: NetworkLinkerRunRow[] = [];
  if (memberIds.length > 0) {
    // Drizzle (0.36 + neon-http) expands an interpolated JS array into a
    // placeholder LIST — `ANY($1, $2)` — which Postgres rejects as a record
    // ("op ANY/ALL (array) requires array on right side"). Bind one Postgres
    // array-literal string and cast per column instead. memberIds are trusted
    // DB-sourced UUIDs, so the comma join is injection-safe.
    const idArray = `{${memberIds.join(',')}}`;
    const rawRuns = (await db.execute(sql`
      SELECT ar.id, ar.status, ar.output, ar.error, ar.started_at
      FROM agent_runs ar
      WHERE ar.agent = 'network-linker'
        AND (
          ar.site_id = ANY(${idArray}::uuid[])
          OR ar.input->>'siteId' = ANY(${idArray}::text[])
          OR EXISTS (
            SELECT 1 FROM link_requests lr
            WHERE lr.id::text = ar.input->>'linkRequestId'
              AND lr.requesting_site_id = ANY(${idArray}::uuid[])
          )
        )
      ORDER BY ar.started_at DESC
      LIMIT 20
    `)) as unknown as { rows: NetworkLinkerRunRow[] } | NetworkLinkerRunRow[];
    recentRuns = Array.isArray(rawRuns) ? rawRuns : rawRuns.rows;
  }

  const crossLinkPaused = await isCrossLinkPaused();
  const roi = await loadNetworkRoi(memberIds);
  const footprint = await scoreNetworkFootprint(id);

  // Stat helpers.
  const activeLinks = recentLinks.filter((l) => l.status === 'active');
  const verifiedLinks = activeLinks.filter((l) => l.verifiedAt).length;

  const callsDelta = roi.calls30d - roi.callsPrev30d;
  const leadsDelta = roi.leads30d - roi.leadsPrev30d;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Networks / Detail</p>
          <h1 className="text-xl md:text-2xl font-semibold mt-1">{networkRow.name}</h1>
          <div className="text-xs text-slate-500 font-mono mt-0.5">{networkRow.slug}</div>
        </div>
        <CrossLinkPauseToggle paused={crossLinkPaused} />
      </header>

      {crossLinkPaused && (
        <div className="rounded-lg border border-amber-700/50 bg-amber-900/30 px-4 py-3 text-sm text-amber-200">
          Network cross-links are paused — no links are injected on live pages and the request seeder is idle.
        </div>
      )}

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Members" value={members.length} />
        <StatCard label="Cross-links (shown)" value={recentLinks.length} />
        <StatCard label="Active links" value={activeLinks.length} />
        <StatCard label="Verified live" value={`${verifiedLinks}/${activeLinks.length}`} />
      </div>

      {/* ROI attribution */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          ROI signal
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Directional, correlational — not a controlled experiment.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <RoiCard
            label="Linked pages rank"
            value={
              roi.posDelta === null
                ? '—'
                : `${roi.posDelta < 0 ? '▲' : roi.posDelta > 0 ? '▼' : ''} ${Math.abs(roi.posDelta).toFixed(1)}`
            }
            sub={
              roi.posBefore !== null && roi.posAfter !== null
                ? `${roi.posBefore.toFixed(1)} → ${roi.posAfter.toFixed(1)} avg pos`
                : `${roi.linkedPages} linked target page(s) with GSC data`
            }
            tone={roi.posDelta === null ? 'neutral' : roi.posDelta < 0 ? 'good' : roi.posDelta > 0 ? 'bad' : 'neutral'}
          />
          <RoiCard
            label="Calls (30d vs prior)"
            value={`${roi.calls30d}`}
            sub={`${callsDelta >= 0 ? '+' : ''}${callsDelta} vs ${roi.callsPrev30d}`}
            tone={callsDelta > 0 ? 'good' : callsDelta < 0 ? 'bad' : 'neutral'}
          />
          <RoiCard
            label="Leads (30d vs prior)"
            value={`${roi.leads30d}`}
            sub={`${leadsDelta >= 0 ? '+' : ''}${leadsDelta} vs ${roi.leadsPrev30d}`}
            tone={leadsDelta > 0 ? 'good' : leadsDelta < 0 ? 'bad' : 'neutral'}
          />
          <RoiCard
            label="Linked target pages"
            value={`${roi.linkedPages}`}
            sub="deep-linked pages w/ rank data"
            tone="neutral"
          />
        </div>
      </section>

      {/* Footprint / detectability */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Footprint risk
        </h2>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 flex flex-wrap items-center gap-6">
          <div>
            <div
              className={`text-3xl font-semibold ${
                footprint.rating === 'high'
                  ? 'text-red-300'
                  : footprint.rating === 'moderate'
                  ? 'text-amber-300'
                  : 'text-emerald-300'
              }`}
            >
              {footprint.score}
              <span className="text-base text-slate-500">/100</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">detectability · {footprint.rating}</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs text-slate-400">
            <Signal label="Anchor repetition" value={footprint.signals.anchorRepetition} />
            <Signal label="Reciprocity density" value={footprint.signals.reciprocityDensity} />
            <Signal label="Temporal clustering" value={footprint.signals.temporalClustering} />
            <Signal label="Homepage share" value={footprint.signals.homepageShare} />
          </div>
        </div>
        {footprint.recommendations.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-amber-200/90 list-disc list-inside">
            {footprint.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
      </section>

      {/* Members table */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Members ({members.length})
        </h2>
        {members.length === 0 ? (
          <Empty>No sites are members of this network yet.</Empty>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                  <Th>Site</Th>
                  <Th>Site status</Th>
                  <Th>Membership</Th>
                  <Th>Budget out</Th>
                  <Th>Budget in</Th>
                  <Th>Joined</Th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.membershipId} className="border-b border-slate-800/60 last:border-0">
                    <Td>
                      <div className="font-medium text-slate-200">
                        {m.siteNiche} — {m.siteCity}, {m.siteState}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">{m.siteId}</div>
                    </Td>
                    <Td>
                      <StatusPill status={m.siteStatus ?? 'unknown'} />
                    </Td>
                    <Td>
                      <StatusPill status={m.status} />
                    </Td>
                    <Td>{m.linkBudgetOutbound}</Td>
                    <Td>{m.linkBudgetInbound}</Td>
                    <Td className="text-slate-400 whitespace-nowrap text-xs">
                      <Timestamp value={m.joinedAt} mode="date" />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent cross-links */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Recent cross-links ({recentLinks.length}{recentLinks.length === 50 ? ', capped at 50' : ''})
        </h2>
        {recentLinks.length === 0 ? (
          <Empty>No cross-site links placed for this network yet.</Empty>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                  <Th>Source site</Th>
                  <Th>Target site</Th>
                  <Th>Anchor</Th>
                  <Th>Target URL</Th>
                  <Th>Placed</Th>
                  <Th>Status</Th>
                  <Th>Verified</Th>
                </tr>
              </thead>
              <tbody>
                {recentLinks.map((l) => (
                  <tr key={l.id} className="border-b border-slate-800/60 last:border-0">
                    <Td className="text-slate-300">{siteLabelMap[l.sourceSiteId] ?? l.sourceSiteId}</Td>
                    <Td className="text-slate-300">{siteLabelMap[l.targetSiteId] ?? l.targetSiteId}</Td>
                    <Td>
                      <code className="text-xs bg-slate-800 px-1 rounded">{l.anchorText}</code>
                    </Td>
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
                    <Td className="text-slate-400 whitespace-nowrap text-xs">
                      {l.placedAt ? <Timestamp value={l.placedAt} /> : <span className="text-slate-600">—</span>}
                    </Td>
                    <Td>
                      <StatusPill status={l.status} />
                    </Td>
                    <Td className="text-center">
                      {l.verifiedAt ? (
                        <span className="text-emerald-400" title="Verified live">&#10003;</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Pending link requests */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Pending link requests ({pendingRequests.length})
        </h2>
        {pendingRequests.length === 0 ? (
          <Empty>No pending link requests for this network.</Empty>
        ) : (
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                  <Th>Requesting site</Th>
                  <Th>Status</Th>
                  <Th>Desired count</Th>
                  <Th>Scheduled for</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody>
                {pendingRequests.map((r) => (
                  <tr key={r.id} className="border-b border-slate-800/60 last:border-0">
                    <Td className="text-slate-300">
                      {memberLabelMap[r.requestingSiteId] ?? r.requestingSiteId}
                    </Td>
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

      {/* Network-linker runs */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Network-linker activity
        </h2>
        {recentRuns.length === 0 ? (
          <Empty>No network-linker runs for this network yet.</Empty>
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
                  <Th>Error</Th>
                  <Th>Started</Th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id} className="border-b border-slate-800/60 last:border-0">
                    <Td>
                      <StatusPill status={r.status} />
                    </Td>
                    <Td className="text-slate-200 font-medium">{r.output?.linksPlaced ?? '—'}</Td>
                    <Td className="text-slate-400">{r.output?.candidatesEvaluated ?? '—'}</Td>
                    <Td className="text-slate-400">{r.output?.hygieneFailed ?? '—'}</Td>
                    <Td className="text-slate-400">{r.output?.llmSkipped ?? '—'}</Td>
                    <Td>
                      {r.error ? (
                        <div className="text-xs text-red-400 max-w-xs truncate" title={r.error}>
                          {r.error}
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </Td>
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

function Signal({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 min-w-[9rem]">
      <span>{label}</span>
      <span className="font-mono text-slate-300">{Math.round(value * 100)}%</span>
    </div>
  );
}

function RoiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'good' | 'bad' | 'neutral';
}) {
  const valueTone =
    tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-red-300' : 'text-slate-100';
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className={`text-2xl font-semibold ${valueTone}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
      <div className="text-[11px] text-slate-600 mt-0.5">{sub}</div>
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
