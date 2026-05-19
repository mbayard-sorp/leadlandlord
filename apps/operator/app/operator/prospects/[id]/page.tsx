import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getDb,
  prospects,
  sites,
  outreachEvents,
  linkedinDmQueue,
  agentApprovals,
  eq,
  asc,
  desc,
  sql,
} from '@leadlandlord/db';
import { ProspectStatusBadge, ScoreBandBadge } from '../badges';

export const dynamic = 'force-dynamic';

function ageLabel(date: Date | string | null): string {
  if (!date) return '—';
  const ms = Date.now() - new Date(date).getTime();
  const hrs = Math.floor(ms / 3600000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(date: Date | string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();

  const [row] = await db
    .select({
      id: prospects.id,
      businessName: prospects.businessName,
      contactName: prospects.contactName,
      phone: prospects.phone,
      email: prospects.email,
      websiteUrl: prospects.websiteUrl,
      source: prospects.source,
      status: prospects.status,
      scoringMetadata: prospects.scoringMetadata,
      lastOutreachAt: prospects.lastOutreachAt,
      createdAt: prospects.createdAt,
      siteId: prospects.siteId,
      niche: sites.niche,
      city: sites.city,
      state: sites.state,
    })
    .from(prospects)
    .leftJoin(sites, eq(prospects.siteId, sites.id))
    .where(eq(prospects.id, id))
    .limit(1);

  if (!row) notFound();

  const [events, dmQueue, approvalRows] = await Promise.all([
    db
      .select()
      .from(outreachEvents)
      .where(eq(outreachEvents.prospectId, id))
      .orderBy(asc(outreachEvents.sentAt)),
    db
      .select()
      .from(linkedinDmQueue)
      .where(eq(linkedinDmQueue.prospectId, id))
      .orderBy(desc(linkedinDmQueue.queuedAt)),
    db
      .select()
      .from(agentApprovals)
      .where(sql`${agentApprovals.payload}->>'prospect_id' = ${id}`)
      .orderBy(desc(agentApprovals.createdAt)),
  ]);

  const sm = row.scoringMetadata as Record<string, unknown> | null;
  const score = typeof sm?.score === 'number' ? sm.score : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl md:text-2xl font-semibold">{row.businessName}</h1>
            <ProspectStatusBadge status={row.status} />
            <ScoreBandBadge score={score} />
          </div>
          <p className="text-sm text-slate-400 mt-1">
            {row.niche ?? '—'}{row.city ? ` / ${row.city}` : ''}{row.state ? `, ${row.state}` : ''}
          </p>
          {(row.contactName || row.phone || row.email) && (
            <p className="text-sm text-slate-500 mt-0.5">
              {[row.contactName, row.phone, row.email].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <Link
          href="/operator/prospects"
          className="text-sm text-slate-400 hover:text-slate-200 shrink-0"
        >
          ← All prospects
        </Link>
      </div>

      {sm && Object.keys(sm).length > 0 && (
        <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-200">Scoring</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-800">
                {Object.entries(sm).map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-1.5 pr-4 text-slate-500 font-mono text-xs w-1/3">{k}</td>
                    <td className="py-1.5 text-slate-300 font-mono text-xs break-all">
                      {typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-200">Outreach timeline</h2>
        {events.length === 0 ? (
          <p className="text-sm text-slate-500">No outreach events yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-slate-500 border-b border-slate-800">
                  <Th>Channel</Th>
                  <Th>Sent</Th>
                  <Th>Response</Th>
                  <Th>Sentiment</Th>
                  <Th>Klaviyo Seq</Th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-slate-800/60 last:border-0">
                    <Td>
                      <span className="text-xs bg-slate-800 px-1.5 py-0.5 rounded font-mono">
                        {e.channel}
                      </span>
                    </Td>
                    <Td className="text-slate-500 whitespace-nowrap text-xs">
                      {formatDate(e.sentAt)}
                    </Td>
                    <Td className="text-slate-400 max-w-xs truncate">{e.response ?? '—'}</Td>
                    <Td className="text-slate-400">{e.sentiment ?? '—'}</Td>
                    <Td className="text-slate-500 font-mono text-xs">
                      {e.klaviyoSequenceId ?? '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-200">LinkedIn DM queue</h2>
        {dmQueue.length === 0 ? (
          <p className="text-sm text-slate-500">No LinkedIn DMs queued.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-slate-500 border-b border-slate-800">
                  <Th>Status</Th>
                  <Th>Queued</Th>
                  <Th>Sent</Th>
                  <Th>Draft</Th>
                </tr>
              </thead>
              <tbody>
                {dmQueue.map((d) => (
                  <tr key={d.id} className="border-b border-slate-800/60 last:border-0">
                    <Td>
                      <span className="text-xs bg-slate-800 px-1.5 py-0.5 rounded font-mono">
                        {d.status}
                      </span>
                    </Td>
                    <Td className="text-slate-500 whitespace-nowrap text-xs">
                      {formatDate(d.queuedAt)}
                    </Td>
                    <Td className="text-slate-500 whitespace-nowrap text-xs">
                      {d.sentAt ? formatDate(d.sentAt) : '—'}
                    </Td>
                    <Td className="text-slate-400 text-xs max-w-xs">
                      {d.draftText.slice(0, 200)}{d.draftText.length > 200 ? '…' : ''}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-200">Approval history</h2>
        {approvalRows.length === 0 ? (
          <p className="text-sm text-slate-500">No approval records for this prospect.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-slate-500 border-b border-slate-800">
                  <Th>Kind</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                  <Th>Decided</Th>
                  <Th>By</Th>
                </tr>
              </thead>
              <tbody>
                {approvalRows.map((a) => (
                  <tr key={a.id} className="border-b border-slate-800/60 last:border-0">
                    <Td>
                      <span className="font-mono text-xs bg-slate-800 px-1.5 py-0.5 rounded">
                        {a.kind}
                      </span>
                    </Td>
                    <Td>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded border ${
                          a.status === 'approved' || a.status === 'auto_approved'
                            ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
                            : a.status === 'rejected'
                            ? 'bg-rose-900/40 text-rose-300 border-rose-700/50'
                            : 'bg-slate-800/60 text-slate-400 border-slate-700'
                        }`}
                      >
                        {a.status}
                      </span>
                    </Td>
                    <Td className="text-slate-500 text-xs whitespace-nowrap">
                      {ageLabel(a.createdAt)}
                    </Td>
                    <Td className="text-slate-500 text-xs whitespace-nowrap">
                      {a.decidedAt ? ageLabel(a.decidedAt) : '—'}
                    </Td>
                    <Td className="text-slate-500 text-xs">{a.decidedBy ?? '—'}</Td>
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

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium text-left">{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
