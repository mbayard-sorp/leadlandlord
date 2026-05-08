import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import {
  getDb,
  sites,
  prospects,
  outreachEvents,
  type Site,
  type Prospect,
  type OutreachEvent,
} from '@leadlandlord/db';
import { runDryRunForSite, promoteProspectToLive } from './actions';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

interface DryRunRow {
  event: OutreachEvent;
  prospect: Prospect | undefined;
}

async function loadDryRunEvents(siteId: string): Promise<DryRunRow[]> {
  const db = getDb();
  // Pull the last 50 dry-run outreach events for prospects on this site.
  // The dryRun branch in outreach-agent tags channel with `_dryrun` suffix
  // AND sets `metadata.dryRun=true` — we filter on the metadata flag for
  // resilience against channel-suffix typos.
  const rows = await db
    .select({
      event: outreachEvents,
      prospect: prospects,
    })
    .from(outreachEvents)
    .innerJoin(prospects, eq(outreachEvents.prospectId, prospects.id))
    .where(
      sql`${prospects.siteId} = ${siteId} AND ${outreachEvents.metadata}->>'dryRun' = 'true'`,
    )
    .orderBy(desc(outreachEvents.sentAt))
    .limit(50);
  return rows.map((r) => ({ event: r.event, prospect: r.prospect ?? undefined }));
}

async function loadUntouchedCount(siteId: string): Promise<number> {
  const db = getDb();
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(prospects)
    .where(sql`${prospects.siteId} = ${siteId} AND ${prospects.status} = 'new'`);
  return result[0]?.count ?? 0;
}

interface ProspectGroup {
  prospect: Prospect;
  events: OutreachEvent[];
}

function groupByProspect(rows: DryRunRow[]): ProspectGroup[] {
  const map = new Map<string, ProspectGroup>();
  for (const r of rows) {
    if (!r.prospect) continue;
    const existing = map.get(r.prospect.id);
    if (existing) {
      existing.events.push(r.event);
    } else {
      map.set(r.prospect.id, { prospect: r.prospect, events: [r.event] });
    }
  }
  return [...map.values()];
}

export default async function OutreachPreviewPage({ params }: Params) {
  const { id } = await params;
  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, id)).limit(1))[0] as
    | Site
    | undefined;
  if (!site) notFound();

  const [rows, untouchedCount] = await Promise.all([
    loadDryRunEvents(id),
    loadUntouchedCount(id),
  ]);
  const groups = groupByProspect(rows);

  return (
    <div className="space-y-8">
      <header>
        <div className="flex items-baseline gap-3">
          <Link
            href={`/operator/sites/${id}`}
            className="text-xs text-sky-400 hover:text-sky-300"
          >
            ← back to site
          </Link>
          <h1 className="text-2xl font-semibold">Outreach preview</h1>
        </div>
        <p className="text-sm text-slate-400 mt-1">
          {site.niche} — {site.city}, {site.state}. Dry-run renders the SMS/email/voice
          script without sending. Use this before the first live close to verify the
          prospect list and copy.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">
          Run dry-run
        </h2>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 flex flex-wrap items-center gap-4">
          <form action={runDryRunForSite} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="site_id" value={id} />
            <label className="text-xs text-slate-400">
              Step{' '}
              <select
                name="step"
                defaultValue="sms_day_0"
                className="ml-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
              >
                <option value="sms_day_0">sms_day_0</option>
                <option value="email_day_1">email_day_1</option>
                <option value="voice_day_3">voice_day_3</option>
                <option value="sms_day_5">sms_day_5</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Count (max 5){' '}
              <input
                type="number"
                name="count"
                defaultValue={5}
                min={1}
                max={5}
                className="ml-1 w-16 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
              />
            </label>
            <button
              type="submit"
              className="px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium"
            >
              Run dry-run
            </button>
          </form>
          <span className="text-xs text-slate-500">
            {untouchedCount} untouched prospect{untouchedCount === 1 ? '' : 's'} (status=new)
          </span>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">
          Recent dry-run events ({rows.length})
        </h2>
        {groups.length === 0 ? (
          <Empty>
            No dry-run events yet for this site. Click &ldquo;Run dry-run&rdquo; above.
          </Empty>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <ProspectCard key={g.prospect.id} siteId={id} group={g} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProspectCard({ siteId, group }: { siteId: string; group: ProspectGroup }) {
  const { prospect, events } = group;
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-800 bg-slate-900/60">
        <div>
          <div className="text-sm font-semibold text-slate-100">{prospect.businessName}</div>
          <div className="text-xs text-slate-500">
            {prospect.contactName ?? '—'} · {prospect.phone ?? '(no phone)'} ·{' '}
            {prospect.email ?? '(no email)'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={prospect.status} />
          <form action={promoteProspectToLive}>
            <input type="hidden" name="site_id" value={siteId} />
            <input type="hidden" name="prospect_id" value={prospect.id} />
            <input type="hidden" name="step" value="sms_day_0" />
            <button
              type="submit"
              className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
              title="Send the live sms_day_0 outreach to this prospect"
            >
              Promote to live
            </button>
          </form>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="text-left px-3 py-2">Channel</th>
            <th className="text-left px-3 py-2">Step</th>
            <th className="text-left px-3 py-2">Body</th>
            <th className="text-left px-3 py-2">Sent at</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {events.map((ev) => {
            const meta = (ev.metadata ?? {}) as Record<string, unknown>;
            const body = (meta.body as string | undefined) ?? '';
            const subject = meta.subject as string | undefined;
            return (
              <tr key={ev.id} className="align-top">
                <td className="px-3 py-2 font-mono text-xs text-slate-400">{ev.channel}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-400">
                  {ev.templateId ?? '—'}
                </td>
                <td className="px-3 py-2 text-xs text-slate-300 whitespace-pre-wrap max-w-xl">
                  {subject ? (
                    <>
                      <span className="text-slate-500">subj:</span> {subject}
                      {'\n\n'}
                    </>
                  ) : null}
                  {body}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                  {new Date(ev.sentAt).toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
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

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'converted'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : status === 'new'
      ? 'bg-slate-800/60 text-slate-300 border-slate-700'
      : status === 'declined' || status === 'lost' || status === 'unreachable'
      ? 'bg-red-900/40 text-red-300 border-red-700/50'
      : 'bg-amber-900/30 text-amber-300 border-amber-700/50';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{status}</span>
  );
}
