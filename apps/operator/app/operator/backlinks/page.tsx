import Link from 'next/link';
import { desc, inArray, eq } from 'drizzle-orm';
import { getDb, backlinks, sites, type Backlink, type Site } from '@leadlandlord/db';
import { BacklinkActions } from './BacklinkActions';

export const dynamic = 'force-dynamic';

const ALL_STATUSES = [
  'pending',
  'submitted',
  'awaiting_reply',
  'accepted',
  'drafting',
  'draft_pending_review',
  'draft_approved',
  'declined',
  'silent',
  'escalated',
  'live',
  'rejected',
  'lost',
] as const;
type StatusFilter = (typeof ALL_STATUSES)[number] | 'all';

interface PageProps {
  searchParams?: Promise<{ status?: string }>;
}

async function loadBacklinks(filter: StatusFilter): Promise<Backlink[]> {
  const db = getDb();
  const q = db.select().from(backlinks).orderBy(desc(backlinks.createdAt));
  if (filter === 'all') return await q.limit(500);
  return await db
    .select()
    .from(backlinks)
    .where(eq(backlinks.status, filter))
    .orderBy(desc(backlinks.createdAt))
    .limit(500);
}

async function loadSitesByIds(ids: string[]): Promise<Map<string, Site>> {
  if (ids.length === 0) return new Map();
  const db = getDb();
  const rows = await db.select().from(sites).where(inArray(sites.id, ids));
  return new Map(rows.map((s) => [s.id, s]));
}

function isStatus(v: string | undefined): v is StatusFilter {
  return v === 'all' || (ALL_STATUSES as readonly string[]).includes(v ?? '');
}

export default async function BacklinksPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const filter: StatusFilter = isStatus(params.status) ? params.status : 'pending';

  const rows = await loadBacklinks(filter);
  const siteMap = await loadSitesByIds([...new Set(rows.map((r) => r.siteId))]);

  // Group by site for the table.
  const grouped = new Map<string, Backlink[]>();
  for (const r of rows) {
    const arr = grouped.get(r.siteId) ?? [];
    arr.push(r);
    grouped.set(r.siteId, arr);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">Backlinks</h1>
          <p className="text-sm text-slate-400 mt-1">
            Citation queue, HARO pitches, and guest-post outreach. Manual queue — operator actions
            each row.
          </p>
        </div>
        <Link
          href="/operator/backlinks/prospects"
          className="inline-flex items-center min-h-[44px] text-xs px-3 rounded border border-sky-700/60 bg-sky-900/30 text-sky-200 hover:bg-sky-900/50 self-start"
        >
          Prospects →
        </Link>
      </header>

      <nav className="flex flex-wrap gap-2 text-xs">
        {([...ALL_STATUSES, 'all'] as const).map((s) => (
          <Link
            key={s}
            href={`/operator/backlinks?status=${s}`}
            className={`inline-flex items-center min-h-[44px] px-3 rounded border ${
              filter === s
                ? 'border-sky-700 bg-sky-900/40 text-sky-200'
                : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            {s}
          </Link>
        ))}
      </nav>

      {grouped.size === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
          No backlinks with status={filter}.
        </div>
      ) : (
        <div className="space-y-6">
          {[...grouped.entries()].map(([siteId, group]) => {
            const site = siteMap.get(siteId);
            const label = site
              ? `${site.niche} — ${site.city}, ${site.state}`
              : siteId.slice(0, 8);
            return (
              <section key={siteId}>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">
                  {label}{' '}
                  <span className="text-xs text-slate-500 normal-case">
                    ({group.length} {group.length === 1 ? 'row' : 'rows'})
                  </span>
                </h2>
                <div className="rounded-lg border border-slate-800 overflow-x-auto -mx-4 sm:mx-0">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="text-left px-3 py-2 hidden sm:table-cell">Type</th>
                        <th className="text-left px-3 py-2">Source domain</th>
                        <th className="text-left px-3 py-2">Status</th>
                        <th className="text-left px-3 py-2 hidden lg:table-cell">Subject / Pitch</th>
                        <th className="text-left px-3 py-2 hidden md:table-cell">Nudges</th>
                        <th className="text-left px-3 py-2 hidden md:table-cell">Action</th>
                        <th className="text-left px-3 py-2 hidden lg:table-cell">Created</th>
                        <th className="text-left px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {group.map((r) => {
                        const md = (r.metadata ?? {}) as Record<string, unknown>;
                        const submitUrl =
                          typeof md.submitUrl === 'string' ? md.submitUrl : null;
                        return (
                          <tr key={r.id} className="hover:bg-slate-900/40 align-top">
                            <td className="px-3 py-2 font-mono text-xs hidden sm:table-cell">{r.type}</td>
                            <td className="px-3 py-2 font-mono text-xs text-slate-300 break-words">
                              {r.sourceDomain}
                              <div className="text-[10px] uppercase tracking-wide text-slate-500 sm:hidden">{r.type}</div>
                            </td>
                            <td className="px-3 py-2">
                              <StatusBadge status={r.status} />
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-300 max-w-md hidden lg:table-cell">
                              {r.subjectLine ? (
                                <div className="font-medium text-slate-200">{r.subjectLine}</div>
                              ) : null}
                              {r.pitchDraft ? (
                                <div className="text-slate-400 mt-0.5">
                                  {truncate(r.pitchDraft, 220)}
                                </div>
                              ) : null}
                              {r.rejectionReason ? (
                                <div className="text-red-300/80 text-xs mt-0.5">
                                  reason: {truncate(r.rejectionReason, 160)}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap hidden md:table-cell">
                              {r.nudgeCount > 0 ? (
                                <div>
                                  <div className="font-mono text-slate-300">{r.nudgeCount}/7</div>
                                  {r.lastNudgeAt ? (
                                    <div className="text-slate-500">
                                      {new Date(r.lastNudgeAt).toLocaleDateString()}
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs hidden md:table-cell">
                              {submitUrl ? (
                                <a
                                  href={submitUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sky-400 hover:text-sky-300"
                                >
                                  Open submit URL
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-400 hidden lg:table-cell">
                              {r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}
                            </td>
                            <td className="px-3 py-2">
                              {r.status === 'pending' ? (
                                <BacklinkActions id={r.id} />
                              ) : r.status === 'draft_pending_review' ||
                                r.status === 'drafting' ||
                                r.status === 'draft_approved' ||
                                (r.status === 'accepted' && r.type === 'guest_post') ? (
                                <Link
                                  href={`/operator/backlinks/${r.id}/draft`}
                                  className="text-xs text-sky-400 hover:text-sky-300"
                                >
                                  {r.status === 'accepted'
                                    ? 'Generate draft'
                                    : r.status === 'drafting'
                                      ? 'In progress…'
                                      : 'Review draft →'}
                                </Link>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'live' || status === 'submitted' || status === 'accepted' || status === 'verified' || status === 'published'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : status === 'pending' || status === 'awaiting_reply' || status === 'drafting' || status === 'draft_pending_review'
      ? 'bg-amber-900/30 text-amber-300 border-amber-700/50'
      : status === 'rejected' || status === 'lost' || status === 'declined' || status === 'dormant'
      ? 'bg-red-900/40 text-red-300 border-red-700/50'
      : status === 'escalated' || status === 'manual_review'
      ? 'bg-fuchsia-900/40 text-fuchsia-200 border-fuchsia-700/50'
      : 'bg-slate-800/60 text-slate-300 border-slate-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{status}</span>
  );
}
