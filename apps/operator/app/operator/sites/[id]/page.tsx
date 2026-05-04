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
import { vercel } from '@leadlandlord/integrations';
import { PhoneAssignmentForm } from './PhoneAssignmentForm';
import { ManualCallForm } from './ManualCallForm';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

interface SiteDetailData {
  site: Site;
  recentCalls: Call[];
  recentLeads: Lead[];
  recentRuns: AgentRun[];
  envVars: ProjectEnv[] | null;
  envVarsError: string | null;
}

interface ProjectEnv {
  key: string;
  type: string;
  target: string[];
  /** Plaintext value when retrievable; otherwise undefined. */
  value?: string;
}

async function loadSiteDetail(id: string): Promise<SiteDetailData | null> {
  const db = getDb();
  const siteRow = (await db.select().from(sites).where(eq(sites.id, id)).limit(1))[0];
  if (!siteRow) return null;
  const [recentCalls, recentLeads, recentRuns, envVarsResult] = await Promise.all([
    db.select().from(calls).where(eq(calls.siteId, id)).orderBy(desc(calls.startedAt)).limit(20),
    db.select().from(leads).where(eq(leads.siteId, id)).orderBy(desc(leads.createdAt)).limit(20),
    db.select().from(agentRuns).where(eq(agentRuns.siteId, id)).orderBy(desc(agentRuns.startedAt)).limit(20),
    loadEnvVars(siteRow.vercelProjectId),
  ]);
  return {
    site: siteRow,
    recentCalls,
    recentLeads,
    recentRuns,
    envVars: envVarsResult.envs,
    envVarsError: envVarsResult.error,
  };
}

async function loadEnvVars(projectId: string | null): Promise<{
  envs: ProjectEnv[] | null;
  error: string | null;
}> {
  if (!projectId) return { envs: null, error: null };
  if (!process.env.VERCEL_TOKEN) return { envs: null, error: 'VERCEL_TOKEN not set' };
  try {
    const envs = await vercel.getEnvVars(projectId, { decrypt: true });
    return {
      envs: envs.map((e) => ({
        key: e.key,
        type: e.type,
        target: e.target,
        value: e.value,
      })),
      error: null,
    };
  } catch (err) {
    return { envs: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function SiteDetailPage({ params }: Params) {
  const { id } = await params;
  const data = await loadSiteDetail(id);
  if (!data) notFound();
  const { site, recentCalls, recentLeads, recentRuns, envVars, envVarsError } = data;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs uppercase tracking-wide text-slate-500">Site</p>
        <h1 className="text-2xl font-semibold mt-1">
          {site.niche} — {site.city}, {site.state}
        </h1>
        <div className="flex flex-wrap gap-3 mt-3 text-sm text-slate-400">
          <Pill>{site.status}</Pill>
          {site.deployedAt && <span>Deployed {new Date(site.deployedAt).toLocaleString()}</span>}
          {site.domain && (
            <a
              href={site.domain}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-400 hover:text-sky-300"
            >
              {site.domain.replace(/^https?:\/\//, '')} ↗
            </a>
          )}
          {site.vercelProjectName && (
            <span className="font-mono text-xs">project: {site.vercelProjectName}</span>
          )}
        </div>
      </header>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Phone &amp; integrations
        </h2>
        <PhoneAssignmentForm site={site} />
      </section>

      <section>
        <header className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Site env vars
          </h2>
          <span className="text-xs text-slate-500">
            Set by Site Builder. Edit by re-running{' '}
            <code className="px-1 py-0.5 bg-slate-800 rounded text-slate-300">
              pnpm dry-run --force
            </code>{' '}
            with new values.
          </span>
        </header>
        <EnvVarsTable envs={envVars} error={envVarsError} />
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

function EnvVarsTable({ envs, error }: { envs: ProjectEnv[] | null; error: string | null }) {
  if (error) {
    return (
      <div className="rounded-lg border border-amber-700/40 bg-amber-900/10 p-4 text-sm text-amber-300">
        Couldn&apos;t load env vars from Vercel: <code className="font-mono">{error}</code>
      </div>
    );
  }
  if (!envs) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-500">
        No Vercel project linked yet — env vars appear once Site Builder deploys this site.
      </div>
    );
  }
  if (envs.length === 0) {
    return <Empty>No env vars set on this project.</Empty>;
  }
  // Sort: NEXT_PUBLIC_* first (visible to bundle), then secrets.
  const sorted = [...envs].sort((a, b) => {
    const ap = a.key.startsWith('NEXT_PUBLIC_') ? 0 : 1;
    const bp = b.key.startsWith('NEXT_PUBLIC_') ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.key.localeCompare(b.key);
  });
  return (
    <Table>
      <thead>
        <tr>
          <th>Key</th>
          <th>Value</th>
          <th>Targets</th>
          <th>Type</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((e) => (
          <tr key={e.key} className="hover:bg-slate-900/40">
            <td className="font-mono text-xs">{e.key}</td>
            <td className="font-mono text-xs text-slate-300">
              {renderEnvValue(e)}
            </td>
            <td>
              <div className="flex gap-1 flex-wrap">
                {e.target.map((t) => (
                  <span
                    key={t}
                    className="inline-block px-1.5 py-0.5 rounded border border-slate-700 bg-slate-800/60 text-[10px] uppercase tracking-wide text-slate-400"
                  >
                    {t.slice(0, 4)}
                  </span>
                ))}
              </div>
            </td>
            <td className="text-xs text-slate-500">{e.type}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Show NEXT_PUBLIC_* values plain (they're already in the bundled JS), mask others. */
function renderEnvValue(e: ProjectEnv): string {
  if (typeof e.value !== 'string') return '(unavailable)';
  if (e.key.startsWith('NEXT_PUBLIC_')) return truncateValue(e.value);
  // Sensitive — show only the first/last 4 chars so the operator can verify
  // they pasted the right value without leaking the whole secret.
  if (e.value.length <= 12) return '••••••••';
  return `${e.value.slice(0, 4)}••••${e.value.slice(-4)}`;
}

function truncateValue(v: string): string {
  if (v.length <= 80) return v;
  return `${v.slice(0, 78)}…`;
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
