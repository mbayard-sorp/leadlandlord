import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import {
  getDb,
  sites,
  calls,
  leads,
  agentRuns,
  type Site,
  type Call,
  type Lead,
  type AgentRun,
} from '@leadlandlord/db';
import {
  fetchSanitySiteDetail,
  fetchKeywordClustersForSite,
  studioDeepLink,
  type SanitySiteDetail,
  type SanityKeywordClusterSummary,
} from '@/lib/sanity-read';
import { PhoneAssignmentForm } from './PhoneAssignmentForm';
import { ManualCallForm } from './ManualCallForm';
import { ThemePicker } from './ThemePicker';
import { DomainAttachForm } from './DomainAttachForm';
import { SiteConfigPanel } from './SiteConfigPanel';
import { RegenerateButtons } from './RegenerateButtons';
import { KeywordsPanel } from './KeywordsPanel';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

interface SiteDetailData {
  site: Site;
  recentCalls: Call[];
  recentLeads: Lead[];
  recentRuns: AgentRun[];
  sanity: SanitySiteDetail | null;
  keywordClusters: SanityKeywordClusterSummary[];
}

async function loadSiteDetail(id: string): Promise<SiteDetailData | null> {
  const db = getDb();
  const siteRow = (await db.select().from(sites).where(eq(sites.id, id)).limit(1))[0];
  if (!siteRow) return null;
  const [recentCalls, recentLeads, recentRuns, sanity, keywordClusters] = await Promise.all([
    db.select().from(calls).where(eq(calls.siteId, id)).orderBy(desc(calls.startedAt)).limit(20),
    db.select().from(leads).where(eq(leads.siteId, id)).orderBy(desc(leads.createdAt)).limit(20),
    db.select().from(agentRuns).where(eq(agentRuns.siteId, id)).orderBy(desc(agentRuns.startedAt)).limit(20),
    fetchSanitySiteDetail(id).catch(() => null),
    fetchKeywordClustersForSite(id).catch(() => [] as SanityKeywordClusterSummary[]),
  ]);
  return { site: siteRow, recentCalls, recentLeads, recentRuns, sanity, keywordClusters };
}

export default async function SiteDetailPage({ params }: Params) {
  const { id } = await params;
  const data = await loadSiteDetail(id);
  if (!data) notFound();
  const { site, recentCalls, recentLeads, recentRuns, sanity, keywordClusters } = data;

  const primaryHost = sanity?.domains.find((d) => d.isPrimary)?.host
    ?? sanity?.domains[0]?.host
    ?? null;
  const dataset = (process.env.SANITY_DATASET ?? 'production') as 'production' | 'development';

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">Site</p>
        <h1 className="text-2xl font-semibold mt-1">
          {sanity?.businessName ?? `${site.niche} — ${site.city}, ${site.state}`}
        </h1>
        <div className="flex flex-wrap gap-3 mt-3 text-sm text-slate-400">
          <Pill>{site.status}</Pill>
          {site.deployedAt && <span>Deployed {new Date(site.deployedAt).toLocaleString()}</span>}
          {primaryHost && (
            <a
              href={`https://${primaryHost}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:text-sky-300"
            >
              {primaryHost} ↗
            </a>
          )}
          {sanity ? (
            <a
              href={studioDeepLink(site.id, dataset)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:text-sky-300"
            >
              Edit in Studio ↗
            </a>
          ) : (
            <span className="text-amber-400 text-xs">⚠ no Sanity site doc — pre-pivot row, regenerate to migrate</span>
          )}
        </div>
      </header>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Theme
        </h2>
        <ThemePicker siteId={site.id} current={sanity?.theme ?? null} />
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Custom domains
        </h2>
        <DomainAttachForm siteId={site.id} domains={sanity?.domains ?? []} />
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Site config
        </h2>
        <SiteConfigPanel
          siteId={site.id}
          initial={{
            gaMeasurementId: sanity?.gaMeasurementId ?? null,
            robotsDisallow: sanity?.robotsDisallow ?? null,
            primaryHost,
          }}
          domainHosts={sanity?.domains.map((d) => d.host) ?? []}
        />
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Regenerate
        </h2>
        <RegenerateButtons
          siteId={site.id}
          hasHeroPrompt={!!sanity?.heroImagePrompt}
        />
        {sanity?.heroImageUrl && (
          <div className="mt-3 rounded border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-400 flex items-center gap-3">
            <span>Current hero:</span>
            <a
              href={sanity.heroImageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:text-sky-300 break-all"
            >
              {sanity.heroImageUrl} ↗
            </a>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          SEO Keywords
        </h2>
        <KeywordsPanel siteId={site.id} clusters={keywordClusters} />
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Phone &amp; integrations
        </h2>
        <PhoneAssignmentForm site={site} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <header className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Recent calls ({recentCalls.length})
            </h2>
          </header>
          <CallsTable rows={recentCalls} />
          <div className="mt-3">
            <ManualCallForm siteId={site.id} />
          </div>
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">
            Recent leads ({recentLeads.length})
          </h2>
          <LeadsTable rows={recentLeads} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">
          Agent runs ({recentRuns.length})
        </h2>
        <AgentRunsTable rows={recentRuns} />
      </section>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded border border-slate-700 bg-slate-800/60 text-slate-200 text-xs">
      {children}
    </span>
  );
}

function CallsTable({ rows }: { rows: Call[] }) {
  if (rows.length === 0) {
    return <Empty>No calls yet. Use the manual entry form below to seed a test row.</Empty>;
  }
  return (
    <Table>
      <thead>
        <tr>
          <th>When</th>
          <th>From</th>
          <th>Dur</th>
          <th>Class</th>
          <th>Recording</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} className="hover:bg-slate-900/40">
            <td className="text-slate-400">{new Date(c.startedAt).toLocaleString()}</td>
            <td className="font-mono text-xs">{c.callerNumber ?? '—'}</td>
            <td className="text-slate-400">{c.durationS ? `${c.durationS}s` : '—'}</td>
            <td>
              <ClassPill v={c.classification} />
            </td>
            <td>
              {c.recordingUrl ? (
                <a
                  href={c.recordingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-400 hover:text-sky-300"
                >
                  Audio ↗
                </a>
              ) : (
                <span className="text-slate-600">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function LeadsTable({ rows }: { rows: Lead[] }) {
  if (rows.length === 0) return <Empty>No leads yet.</Empty>;
  return (
    <Table>
      <thead>
        <tr>
          <th>When</th>
          <th>Contact</th>
          <th>Source</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((l) => (
          <tr key={l.id} className="hover:bg-slate-900/40">
            <td className="text-slate-400">{new Date(l.createdAt).toLocaleString()}</td>
            <td>
              <div>{l.name ?? '—'}</div>
              <div className="text-xs text-slate-500 font-mono">{l.phone ?? l.email ?? ''}</div>
            </td>
            <td className="text-slate-400">{l.source}</td>
            <td className="text-xs">
              <span className="text-slate-500">sms:</span> {pillTone(l.smsStatus)}{' '}
              <span className="text-slate-500 ml-1">email:</span> {pillTone(l.emailStatus)}{' '}
              {l.klaviyoProfileId && (
                <span className="ml-1 text-emerald-300/80">klaviyo ✓</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function AgentRunsTable({ rows }: { rows: AgentRun[] }) {
  if (rows.length === 0) return <Empty>No agent runs for this site yet.</Empty>;
  return (
    <Table>
      <thead>
        <tr>
          <th>Agent</th>
          <th>Status</th>
          <th>Started</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="hover:bg-slate-900/40">
            <td className="font-mono">{r.agent}</td>
            <td>{r.status}</td>
            <td className="text-slate-400">{new Date(r.startedAt).toLocaleString()}</td>
            <td className="text-slate-400">${Number(r.costUsd).toFixed(4)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-800 overflow-hidden">
      <table className="w-full text-sm [&_th]:text-left [&_th]:px-3 [&_th]:py-2 [&_th]:bg-slate-900 [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-slate-500 [&_td]:px-3 [&_td]:py-2 [&_tbody]:divide-y [&_tbody]:divide-slate-800">
        {children}
      </table>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

function ClassPill({ v }: { v: string }) {
  const tone =
    v === 'won'
      ? 'text-emerald-300 border-emerald-700/50 bg-emerald-900/30'
      : v === 'quoted'
      ? 'text-sky-300 border-sky-700/50 bg-sky-900/30'
      : v === 'lost'
      ? 'text-amber-300 border-amber-700/50 bg-amber-900/30'
      : v === 'spam'
      ? 'text-red-300 border-red-700/50 bg-red-900/30'
      : 'text-slate-400 border-slate-700 bg-slate-800/60';
  return <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{v}</span>;
}

function pillTone(s: string | null): React.ReactNode {
  if (!s) return <span className="text-slate-600">—</span>;
  const tone =
    s === 'sent'
      ? 'text-emerald-300/80'
      : s === 'failed'
      ? 'text-red-300/80'
      : s === 'skipped'
      ? 'text-slate-500'
      : 'text-amber-300/80';
  return <span className={tone}>{s}</span>;
}
