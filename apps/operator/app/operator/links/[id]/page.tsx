import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, desc } from 'drizzle-orm';
import { getDb, backlinks, sites, tenants, emailSends } from '@leadlandlord/db';
import { StatusBadge } from '@/components/StatusBadge';
import { DetailActions } from './DetailActions';
import { ageLabel } from '@/lib/links/stages';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

function TimelineEntry({
  at,
  label,
  detail,
}: {
  at: string | Date | null;
  label: string;
  detail?: string | null;
}) {
  if (!at) return null;
  return (
    <div className="relative pl-5">
      <span className="absolute left-0 top-1.5 w-2 h-2 rounded-full bg-slate-600 border border-slate-700" />
      <div className="text-xs text-slate-300 font-medium">{label}</div>
      <div className="text-[11px] text-slate-500">
        {typeof at === 'string' ? new Date(at).toLocaleString() : at.toLocaleString()}
      </div>
      {detail && (
        <div className="text-xs text-slate-400 mt-0.5 font-mono bg-slate-900/60 rounded px-2 py-1 break-words">
          {detail}
        </div>
      )}
    </div>
  );
}

export default async function BacklinkDetailPage({ params }: PageProps) {
  const { id } = await params;
  const db = getDb();

  const [row] = await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1);
  if (!row) notFound();

  const [site, tenant, recentSends] = await Promise.all([
    db.select().from(sites).where(eq(sites.id, row.siteId)).limit(1).then((r) => r[0] ?? null),
    undefined as undefined,
    // Email sends for this site, recent ones linkable to this domain
    db
      .select()
      .from(emailSends)
      .where(eq(emailSends.siteId, row.siteId))
      .orderBy(desc(emailSends.sentAt))
      .limit(20),
  ]);

  const tenantRow = site?.tenantId
    ? (await db.select().from(tenants).where(eq(tenants.id, site.tenantId)).limit(1))[0] ?? null
    : null;

  const md = (row.metadata ?? {}) as Record<string, unknown>;
  const replyLog = Array.isArray(md.replyLog) ? (md.replyLog as Array<Record<string, unknown>>) : [];
  const responseSnippet = typeof md.responseSnippet === 'string' ? md.responseSnippet : null;
  const anchorText = typeof md.anchorText === 'string' ? md.anchorText : null;

  const inDraftPhase =
    row.status === 'draft_pending_review' ||
    row.status === 'draft_approved' ||
    row.status === 'accepted';

  // Build timeline entries
  interface TEntry { at: Date | string | null; label: string; detail?: string | null }
  const timeline: TEntry[] = [];

  if (row.createdAt) {
    timeline.push({ at: row.createdAt, label: 'Created / pitched' });
  }

  // Email sends that match this domain
  const domainSends = recentSends.filter((s) => {
    // heuristic: toAddress domain matches sourceDomain
    return s.toAddress.toLowerCase().includes(row.sourceDomain.toLowerCase());
  });
  for (const s of domainSends) {
    timeline.push({
      at: s.sentAt,
      label: `Email sent (${s.purpose})`,
      detail: s.subject,
    });
  }

  for (const entry of replyLog) {
    if (entry.at && entry.message) {
      timeline.push({
        at: entry.at as string,
        label: 'Reply received',
        detail: typeof entry.message === 'string' ? entry.message.slice(0, 300) : null,
      });
    }
  }

  if (responseSnippet) {
    timeline.push({
      at: row.createdAt,
      label: 'Response received',
      detail: responseSnippet.slice(0, 300),
    });
  }

  if (row.nudgeCount > 0 && row.lastNudgeAt) {
    timeline.push({
      at: row.lastNudgeAt,
      label: `Nudged (${row.nudgeCount} total)`,
    });
  }

  if (row.publishedAt) {
    timeline.push({
      at: row.publishedAt,
      label: 'Published / live',
      detail: row.publishedUrl ?? null,
    });
  }

  // Sort timeline ascending
  timeline.sort((a, b) => {
    const ta = a.at ? new Date(a.at).getTime() : 0;
    const tb = b.at ? new Date(b.at).getTime() : 0;
    return ta - tb;
  });

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-xl text-slate-100">{row.sourceDomain}</span>
            <StatusBadge status={row.status} />
            {inDraftPhase && (
              <Link
                href={`/operator/links/${row.id}/draft`}
                className="text-xs px-2.5 py-1 rounded bg-amber-700/40 hover:bg-amber-700/60 text-amber-200"
              >
                Review draft →
              </Link>
            )}
          </div>
          {site && (
            <p className="text-sm text-slate-400 mt-1">
              {site.niche} — {site.city}, {site.state}
              {tenantRow ? ` · ${tenantRow.businessName}` : ''}
            </p>
          )}
        </div>
        <Link
          href="/operator/links"
          className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:border-slate-500"
        >
          ← Links hub
        </Link>
      </header>

      {/* Stats card */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <StatItem label="Type" value={row.type} mono />
          <StatItem label="Anchor type" value={row.anchorType ?? '—'} mono />
          <StatItem label="Anchor text" value={anchorText ?? '—'} mono />
          <StatItem label="Nudges" value={row.nudgeCount > 0 ? `${row.nudgeCount}/7` : '0'} mono />
          <StatItem
            label="Published URL"
            value={row.publishedUrl ?? '—'}
            mono
          />
          <StatItem
            label="Age in stage"
            value={ageLabel(row.createdAt)}
          />
        </div>
      </div>

      {/* Timeline */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <div className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-3">
          Timeline
        </div>
        {timeline.length === 0 ? (
          <p className="text-xs text-slate-500">No timeline events yet.</p>
        ) : (
          <div className="space-y-3 border-l border-slate-700 pl-0">
            {timeline.map((entry, i) => (
              <TimelineEntry
                key={i}
                at={entry.at}
                label={entry.label}
                detail={entry.detail}
              />
            ))}
          </div>
        )}
      </section>

      {/* Manual overrides */}
      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <DetailActions id={row.id} status={row.status} />
      </section>
    </div>
  );
}

function StatItem({
  label,
  value,
  mono,
  warn,
}: {
  label: string;
  value: string;
  mono?: boolean;
  warn?: boolean;
}) {
  return (
    <div>
      <div className="text-slate-500 uppercase tracking-wide mb-0.5">{label}</div>
      <div className={`${mono ? 'font-mono break-all' : ''} ${warn ? 'text-amber-300' : 'text-slate-200'} text-xs`}>
        {value}
      </div>
    </div>
  );
}
