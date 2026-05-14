import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, bccGraduation, agentRuns, type BccGraduation } from '@leadlandlord/db';
import { MOLLY_PERSONA } from '@leadlandlord/agents/molly/persona';
import { toggleManualOverride, setBccAddress } from './actions';

interface InboxStats {
  lastPollAt: Date | null;
  lastPollScanned: number | null;
  lastPollMatched: number | null;
  accepted24h: number;
  declined24h: number;
  silent24h: number;
  escalated24h: number;
}

async function loadInboxStats(): Promise<InboxStats> {
  const db = getDb();
  const lastRun = (
    await db
      .select({
        startedAt: agentRuns.startedAt,
        output: agentRuns.output,
      })
      .from(agentRuns)
      .where(and(eq(agentRuns.agent, 'molly-inbox'), eq(agentRuns.status, 'succeeded')))
      .orderBy(desc(agentRuns.startedAt))
      .limit(1)
  )[0];
  const lastOutput = (lastRun?.output ?? null) as { scanned?: number; matched?: number } | null;

  const counts = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'accepted')  AS accepted,
      COUNT(*) FILTER (WHERE status = 'declined')  AS declined,
      COUNT(*) FILTER (WHERE status = 'silent')    AS silent,
      COUNT(*) FILTER (WHERE status = 'escalated') AS escalated
    FROM backlinks
    WHERE type = 'guest_post'
      AND response_at >= NOW() - INTERVAL '24 hours'
  `)) as unknown as
    | { rows: Array<{ accepted: number; declined: number; silent: number; escalated: number }> }
    | Array<{ accepted: number; declined: number; silent: number; escalated: number }>;
  const row = (Array.isArray(counts) ? counts[0] : counts.rows[0]) ?? {
    accepted: 0,
    declined: 0,
    silent: 0,
    escalated: 0,
  };
  return {
    lastPollAt: lastRun?.startedAt ?? null,
    lastPollScanned: lastOutput?.scanned ?? null,
    lastPollMatched: lastOutput?.matched ?? null,
    accepted24h: Number(row.accepted ?? 0),
    declined24h: Number(row.declined ?? 0),
    silent24h: Number(row.silent ?? 0),
    escalated24h: Number(row.escalated ?? 0),
  };
}

export const dynamic = 'force-dynamic';

const GRADUATION_THRESHOLD = 20;

async function loadMollyState(): Promise<BccGraduation | null> {
  const db = getDb();
  const row = (
    await db
      .select()
      .from(bccGraduation)
      .where(eq(bccGraduation.agentName, 'molly'))
      .limit(1)
  )[0];
  return row ?? null;
}

export default async function MollyPage() {
  const [row, inbox] = await Promise.all([loadMollyState(), loadInboxStats()]);
  const envFallback = process.env.MOLLY_BCC_ADDRESS ?? null;
  const flagEnabled = process.env.ZOHO_MOLLY_ENABLED === 'true';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold">Molly</h1>
        <p className="text-sm text-slate-400 mt-1">
          Outreach persona for the guest-post pipeline. Graduation tracks the
          first {GRADUATION_THRESHOLD} successful sends; BCC stops once she
          graduates unless manual override is on.
        </p>
      </div>

      {!flagEnabled && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          <strong>ZOHO_MOLLY_ENABLED is not set.</strong> Molly mode is off — outbound
          pitches still route through the generic mailbox. Set the env var to flip
          BacklinkBuilder.guest_post into Molly mode.
        </div>
      )}

      <section className="rounded border border-slate-800 bg-slate-900/40 p-5 space-y-4">
        <h2 className="text-base font-semibold">BCC graduation</h2>
        {!row ? (
          <p className="text-sm text-slate-400">
            No <code className="text-xs">bcc_graduation</code> row for
            <code className="text-xs"> molly</code>. Apply migration 0019.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-slate-400">Outbound count</dt>
              <dd>
                {row.outboundCount} / {GRADUATION_THRESHOLD}
              </dd>
              <dt className="text-slate-400">Graduated</dt>
              <dd>
                {row.graduatedAt
                  ? new Date(row.graduatedAt).toLocaleString()
                  : 'not yet'}
              </dd>
              <dt className="text-slate-400">Manual override</dt>
              <dd>{row.manualOverride ? 'on (forcing BCC)' : 'off'}</dd>
              <dt className="text-slate-400">BCC address (column)</dt>
              <dd>{row.bccAddress ?? <span className="text-slate-500">unset</span>}</dd>
              <dt className="text-slate-400">BCC address (env fallback)</dt>
              <dd>
                {envFallback ?? <span className="text-slate-500">unset</span>}
              </dd>
            </dl>

            <form action={toggleManualOverride}>
              <button
                type="submit"
                className="text-sm px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700"
              >
                {row.manualOverride ? 'Disable' : 'Enable'} manual override
              </button>
            </form>

            <form action={setBccAddress} className="flex gap-2 items-end">
              <label className="text-sm flex-1">
                <span className="block text-slate-400 mb-1">BCC address</span>
                <input
                  type="email"
                  name="bccAddress"
                  defaultValue={row.bccAddress ?? ''}
                  placeholder={envFallback ?? 'reviewer@example.com'}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-sm"
                />
              </label>
              <button
                type="submit"
                className="text-sm px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700"
              >
                Save
              </button>
            </form>
            <p className="text-xs text-slate-500">
              Leave blank to fall through to the <code>MOLLY_BCC_ADDRESS</code> env var.
            </p>
          </>
        )}
      </section>

      <section className="rounded border border-slate-800 bg-slate-900/40 p-5 space-y-3">
        <h2 className="text-base font-semibold">Inbox activity (last 24h)</h2>
        <dl className="grid grid-cols-[180px_1fr] gap-y-2 text-sm">
          <dt className="text-slate-400">Last poll</dt>
          <dd>
            {inbox.lastPollAt
              ? `${new Date(inbox.lastPollAt).toLocaleString()} (scanned ${inbox.lastPollScanned ?? 0}, matched ${inbox.lastPollMatched ?? 0})`
              : <span className="text-slate-500">no successful run yet</span>}
          </dd>
          <dt className="text-slate-400">Accepted</dt>
          <dd className="font-mono text-emerald-300">{inbox.accepted24h}</dd>
          <dt className="text-slate-400">Declined</dt>
          <dd className="font-mono text-red-300">{inbox.declined24h}</dd>
          <dt className="text-slate-400">Silent / auto-reply</dt>
          <dd className="font-mono text-slate-300">{inbox.silent24h}</dd>
          <dt className="text-slate-400">Escalated (needs review)</dt>
          <dd className="font-mono text-fuchsia-300">{inbox.escalated24h}</dd>
        </dl>
        {inbox.escalated24h > 0 && (
          <p className="text-xs text-fuchsia-300/80">
            Escalated rows are visible in{' '}
            <a className="underline hover:text-fuchsia-200" href="/operator/backlinks?status=escalated">
              backlinks → escalated
            </a>
            .
          </p>
        )}
      </section>

      <section className="rounded border border-slate-800 bg-slate-900/40 p-5 space-y-3">
        <h2 className="text-base font-semibold">Persona</h2>
        <dl className="grid grid-cols-[180px_1fr] gap-y-2 text-sm">
          <dt className="text-slate-400">Name</dt>
          <dd>{MOLLY_PERSONA.name}</dd>
          <dt className="text-slate-400">Title</dt>
          <dd>{MOLLY_PERSONA.title}</dd>
          <dt className="text-slate-400">Mailbox</dt>
          <dd>
            <code className="text-xs">{MOLLY_PERSONA.mailbox}</code>
          </dd>
          <dt className="text-slate-400">From header</dt>
          <dd>
            <code className="text-xs">
              {MOLLY_PERSONA.displayName} &lt;
              {process.env.ZOHO_MOLLY_FROM ?? MOLLY_PERSONA.mailbox}&gt;
            </code>
          </dd>
          <dt className="text-slate-400">Signature</dt>
          <dd>{MOLLY_PERSONA.signatureLine}</dd>
        </dl>
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
            Voice system prompt
          </summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded p-3">
            {MOLLY_PERSONA.voiceSystemPrompt}
          </pre>
        </details>
      </section>
    </div>
  );
}
