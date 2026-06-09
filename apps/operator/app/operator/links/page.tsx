import Link from 'next/link';
import {
  loadWorkstreamHealth,
  loadStageCounts,
  loadNeedsYou,
  loadInFlightGroups,
  loadCitationGroups,
  loadAllSites,
  loadProspectPool,
  loadRecentEmailSends,
} from '@/lib/links/hub-data';
import { FUNNEL_STAGES, ageLabel, type UIStage } from '@/lib/links/stages';
import { StatusBadge } from '@/components/StatusBadge';
import { MeterBar } from '@/components/MeterBar';
import { WorkstreamToggle } from './WorkstreamToggle';
import { CitationSubmitButton } from './CitationSubmitButton';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ tab?: string; stage?: string }>;
}

const TABS = ['outreach', 'citations', 'prospects', 'inbox'] as const;
type Tab = (typeof TABS)[number];

function isTab(v: string | undefined): v is Tab {
  return TABS.includes(v as Tab);
}

export default async function LinksHubPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tab: Tab = isTab(sp.tab) ? sp.tab : 'outreach';
  const stageFilter = sp.stage as UIStage | undefined;

  const siteMap = await loadAllSites();

  const [health, stageCounts, needsYou, inFlightGroups, citationGroups] = await Promise.all([
    loadWorkstreamHealth(),
    loadStageCounts(),
    loadNeedsYou(siteMap),
    loadInFlightGroups(siteMap),
    loadCitationGroups(siteMap),
  ]);

  const totalNeedsYou =
    needsYou.prospectReviewCount + needsYou.draftReviewCount + needsYou.escalations.length;

  // Prospect pool for prospects tab
  const prospectPool = tab === 'prospects' ? await loadProspectPool() : [];

  // Email sends for inbox tab
  const emailSends = tab === 'inbox' ? await loadRecentEmailSends() : [];

  // Filter in-flight groups by stage if set
  const filteredGroups = stageFilter
    ? inFlightGroups
        .map((g) => ({
          ...g,
          rows: g.rows.filter((r) => r.stage === stageFilter),
        }))
        .filter((g) => g.rows.length > 0)
    : inFlightGroups;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-6">
      {/* Header */}
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Link building</h1>
        <p className="text-sm text-slate-400 mt-1">
          Guest-post outreach, citations, and prospect pipeline.
        </p>
      </header>

      {/* A. Workstream health bar */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* Running pill */}
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                health.running
                  ? 'bg-emerald-900/40 text-emerald-200 border-emerald-700/50'
                  : 'bg-amber-900/40 text-amber-200 border-amber-700/50'
              }`}
            >
              {health.running && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                </span>
              )}
              {health.running ? 'Running' : 'Paused'}
            </span>

            {/* Pacing readout */}
            <div className="text-xs text-slate-400 space-x-3">
              <span>
                <span className="text-slate-200 font-medium">{health.pitchesThisWeek}</span>{' '}
                pitches this week
              </span>
              {health.lastScorerRunAt && (
                <span>
                  Last scored{' '}
                  <span className="text-slate-200">{ageLabel(health.lastScorerRunAt)}</span>
                </span>
              )}
            </div>
          </div>

          <WorkstreamToggle running={health.running} />
        </div>
      </div>

      {/* Paused banner */}
      {!health.running && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-200">
          Link building is paused — agents will not scout, send, or nudge.
        </div>
      )}

      {/* B. Needs-you grid */}
      {totalNeedsYou === 0 ? (
        <div className="rounded-lg border border-emerald-800/40 bg-emerald-900/10 px-4 py-2.5 text-sm text-emerald-300">
          Nothing needs you.
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-4">
          {/* Prospect review card */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">
              Prospect review
            </div>
            {needsYou.prospectReviewCount > 0 ? (
              <>
                <div className="text-2xl font-bold text-amber-300">
                  {needsYou.prospectReviewCount}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">awaiting your decision</div>
                <Link
                  href="/operator/links/review"
                  className="mt-3 inline-flex items-center text-xs px-3 py-1.5 rounded bg-amber-700/40 hover:bg-amber-700/60 text-amber-100"
                >
                  Review session →
                </Link>
              </>
            ) : (
              <div className="text-sm text-slate-500 mt-1">All clear</div>
            )}
          </div>

          {/* Draft review card */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">
              Draft review
            </div>
            {needsYou.draftReviewCount > 0 ? (
              <>
                <div className="text-2xl font-bold text-amber-300">
                  {needsYou.draftReviewCount}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">drafts pending approval</div>
              </>
            ) : (
              <div className="text-sm text-slate-500 mt-1">No pending drafts</div>
            )}
          </div>

          {/* Escalations card */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">
              Escalations
            </div>
            {needsYou.escalations.length > 0 ? (
              <div className="space-y-2 mt-1">
                {needsYou.escalations.map((e) => (
                  <div key={e.id} className="text-xs">
                    <Link
                      href={`/operator/links/${e.id}`}
                      className="font-mono text-fuchsia-300 hover:text-fuchsia-200"
                    >
                      {e.sourceDomain}
                    </Link>
                    <div className="text-slate-500 truncate">{e.siteLabel}</div>
                    {e.responseSnippet && (
                      <div className="text-slate-400 truncate italic">{e.responseSnippet}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-500 mt-1">No escalations</div>
            )}
          </div>
        </div>
      )}

      {/* C. Funnel strip */}
      <div className="flex flex-wrap gap-2">
        {FUNNEL_STAGES.map((stage) => {
          const count = stageCounts[stage];
          const isActive = stageFilter === stage;
          return (
            <Link
              key={stage}
              href={
                isActive
                  ? `/operator/links?tab=${tab}`
                  : `/operator/links?tab=${tab}&stage=${encodeURIComponent(stage)}`
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs transition-colors ${
                isActive
                  ? 'border-sky-600 bg-sky-900/40 text-sky-200'
                  : 'border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >
              {stage}
              <span
                className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full text-[11px] font-mono px-1 ${
                  isActive ? 'bg-sky-800/60 text-sky-100' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-800">
        <nav className="flex gap-1 -mb-px">
          {TABS.map((t) => (
            <Link
              key={t}
              href={`/operator/links?tab=${t}${stageFilter ? `&stage=${encodeURIComponent(stageFilter)}` : ''}`}
              className={`px-4 py-2 text-sm border-b-2 transition-colors ${
                tab === t
                  ? 'border-sky-500 text-sky-200'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Link>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {tab === 'outreach' && (
        <OutreachTab groups={filteredGroups} stageFilter={stageFilter} />
      )}
      {tab === 'citations' && <CitationsTab groups={citationGroups} />}
      {tab === 'prospects' && <ProspectsTab rows={prospectPool} />}
      {tab === 'inbox' && <InboxTab sends={emailSends} />}
    </div>
  );
}

// ---- Outreach tab ----

function OutreachTab({
  groups,
  stageFilter,
}: {
  groups: Awaited<ReturnType<typeof loadInFlightGroups>>;
  stageFilter?: UIStage;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-500">
        {stageFilter
          ? `No outreach rows in stage "${stageFilter}".`
          : 'No active outreach yet. Approve some prospects to get started.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.siteId}>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h2 className="text-sm font-semibold text-slate-200">{g.siteLabel}</h2>
            {g.citationTotal > 0 ? (
              <MeterBar
                value={g.citationLive}
                max={g.citationTotal}
                className="w-28"
              />
            ) : (
              <span className="text-xs text-slate-600">Citations: coming soon</span>
            )}
          </div>
          <div className="rounded-lg border border-slate-800 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Domain</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2 hidden sm:table-cell">Age</th>
                  <th className="text-left px-3 py-2 hidden md:table-cell">Last event</th>
                  <th className="text-left px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {g.rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`hover:bg-slate-900/40 ${
                      r.isDraftReview || r.isEscalated ? 'bg-amber-950/10' : ''
                    }`}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-slate-200">
                      {r.kind === 'backlink' ? (
                        <Link
                          href={`/operator/links/${r.id}`}
                          className="hover:text-sky-300"
                        >
                          {r.sourceDomain}
                        </Link>
                      ) : (
                        <span className="text-slate-400">{r.sourceDomain}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-xs hidden sm:table-cell">
                      <span className={r.ageInStageDays > 7 ? 'text-amber-300' : 'text-slate-500'}>
                        {r.ageInStageDays}d
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400 hidden md:table-cell">
                      {r.lastEventLabel ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      {(r.isDraftReview || r.isEscalated) && r.draftLink ? (
                        <Link
                          href={r.draftLink}
                          className="text-xs text-amber-300 hover:text-amber-200 whitespace-nowrap"
                        >
                          Review →
                        </Link>
                      ) : r.kind === 'backlink' ? (
                        <Link
                          href={`/operator/links/${r.id}`}
                          className="text-slate-500 hover:text-slate-300 text-xs"
                        >
                          ›
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

// ---- Citations tab ----

function CitationsTab({
  groups,
}: {
  groups: Awaited<ReturnType<typeof loadCitationGroups>>;
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-500">
        No citation or directory rows yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.siteId}>
          <h2 className="text-sm font-semibold text-slate-200 mb-2">{g.siteLabel}</h2>
          <div className="rounded-lg border border-slate-800 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2">Directory</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2 hidden md:table-cell">Submit link</th>
                  <th className="text-left px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {g.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-900/40">
                    <td className="px-3 py-2 font-mono text-xs text-slate-200">
                      {r.sourceDomain}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-xs hidden md:table-cell">
                      {r.submitUrl ? (
                        <a
                          href={r.submitUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-400 hover:text-sky-300"
                        >
                          Open ↗
                        </a>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.status === 'pending' && <CitationSubmitButton id={r.id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

// ---- Prospects tab ----

function ProspectsTab({
  rows,
}: {
  rows: Awaited<ReturnType<typeof loadProspectPool>>;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-500">
        No prospects yet. Run a scout from the review session.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="text-left px-3 py-2">Domain</th>
            <th className="text-left px-3 py-2">Site</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-left px-3 py-2 hidden md:table-cell">Score</th>
            <th className="text-left px-3 py-2 hidden lg:table-cell">Contact</th>
            <th className="text-left px-3 py-2 hidden lg:table-cell">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((r) => {
            const md = (r.metadata ?? {}) as Record<string, unknown>;
            const snoozedUntil =
              typeof md.snoozedUntil === 'string' ? new Date(md.snoozedUntil) : null;
            const isSnoozed = snoozedUntil && snoozedUntil > new Date();
            return (
              <tr key={r.id} className={`hover:bg-slate-900/40 ${isSnoozed ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2 font-mono text-xs text-slate-200">
                  {r.domain}
                  {isSnoozed && (
                    <span className="ml-1 text-[10px] text-slate-500">
                      (snoozed until {snoozedUntil!.toLocaleDateString()})
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-400">{r.siteLabel}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2 text-xs text-slate-300 hidden md:table-cell font-mono">
                  {r.score != null ? Number(r.score).toFixed(0) : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-slate-400 hidden lg:table-cell">
                  <div>{r.contactEmail ?? <span className="text-red-400">missing</span>}</div>
                  {r.contactState && (
                    <div className="text-[10px] text-slate-500">{r.contactState}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500 hidden lg:table-cell">
                  {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Inbox tab ----

function InboxTab({
  sends,
}: {
  sends: Awaited<ReturnType<typeof loadRecentEmailSends>>;
}) {
  if (sends.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center text-sm text-slate-500">
        No recent email sends.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="text-left px-3 py-2">To</th>
            <th className="text-left px-3 py-2">Subject</th>
            <th className="text-left px-3 py-2 hidden md:table-cell">Purpose</th>
            <th className="text-left px-3 py-2 hidden md:table-cell">Status</th>
            <th className="text-left px-3 py-2 hidden lg:table-cell">Sent</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {sends.map((r) => (
            <tr key={r.id} className="hover:bg-slate-900/40">
              <td className="px-3 py-2 font-mono text-xs text-slate-300">{r.toAddress}</td>
              <td className="px-3 py-2 text-xs text-slate-200 max-w-xs truncate">{r.subject}</td>
              <td className="px-3 py-2 text-xs text-slate-400 hidden md:table-cell">
                {r.purpose}
              </td>
              <td className="px-3 py-2 text-xs hidden md:table-cell">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-3 py-2 text-xs text-slate-500 hidden lg:table-cell">
                {r.sentAt ? new Date(r.sentAt).toLocaleString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
