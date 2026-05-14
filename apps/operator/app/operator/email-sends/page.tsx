import Link from 'next/link';
import {
  getDb,
  emailSends,
  desc,
  eq,
  and,
  getRemainingSendsToday,
  type EmailSend,
} from '@leadlandlord/db';

export const dynamic = 'force-dynamic';

const ALL_STATUSES = ['sent', 'failed', 'throttled'] as const;
type StatusFilter = (typeof ALL_STATUSES)[number] | 'all';

interface PageProps {
  searchParams?: Promise<{
    status?: string;
    mailbox?: string;
    limit?: string;
  }>;
}

function isStatus(v: string | undefined): v is StatusFilter {
  return v === 'all' || (ALL_STATUSES as readonly string[]).includes(v ?? '');
}

async function loadSends(
  filter: StatusFilter,
  mailboxFilter: string | null,
  limit: number,
): Promise<EmailSend[]> {
  const db = getDb();
  const conds = [];
  if (filter !== 'all') conds.push(eq(emailSends.status, filter));
  if (mailboxFilter) conds.push(eq(emailSends.mailbox, mailboxFilter));
  const whereClause =
    conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
  const base = db.select().from(emailSends);
  const q = whereClause ? base.where(whereClause) : base;
  return await q.orderBy(desc(emailSends.sentAt)).limit(limit);
}

export default async function EmailSendsPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const filter: StatusFilter = isStatus(params.status) ? params.status : 'all';
  const mailboxFilter = params.mailbox && params.mailbox.length > 0 ? params.mailbox : null;
  const parsedLimit = Number.parseInt(params.limit ?? '', 10);
  const limit = Math.min(
    500,
    Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 200,
  );

  const rows = await loadSends(filter, mailboxFilter, limit);

  const distinctMailboxes = [...new Set(rows.map((r) => r.mailbox))];
  const counterMailboxes = mailboxFilter ? [mailboxFilter] : distinctMailboxes;
  const counters = await Promise.all(
    counterMailboxes.map(async (m) => ({ mailbox: m, ...(await getRemainingSendsToday(m)) })),
  );

  const buildHref = (overrides: { status?: StatusFilter; mailbox?: string | null }) => {
    const sp = new URLSearchParams();
    const nextStatus = overrides.status ?? filter;
    if (nextStatus !== 'all') sp.set('status', nextStatus);
    const nextMailbox =
      overrides.mailbox === undefined ? mailboxFilter : overrides.mailbox;
    if (nextMailbox) sp.set('mailbox', nextMailbox);
    const qs = sp.toString();
    return qs ? `/operator/email-sends?${qs}` : '/operator/email-sends';
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Email sends</h1>
        <p className="text-sm text-slate-400 mt-1">
          Audit log of agent-sent emails. Daily caps follow the Zoho warmup schedule —
          throttled rows are recorded but do not count toward today&apos;s usage.
        </p>
      </header>

      {counters.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
          No emails sent yet.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {counters.map((c) => (
            <div
              key={c.mailbox}
              className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"
            >
              <div className="font-mono text-xs text-slate-300">{c.mailbox}</div>
              <div className="text-lg font-semibold text-slate-100 mt-1">
                {c.sentToday} / {c.cap}{' '}
                <span className="text-xs font-normal text-slate-400">sent today</span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {c.remaining} remaining. Cap rises after warmup.
              </div>
            </div>
          ))}
        </div>
      )}

      <nav className="flex flex-wrap gap-2 text-xs items-center">
        {(['all', 'sent', 'failed', 'throttled'] as const).map((s) => (
          <Link
            key={s}
            href={buildHref({ status: s })}
            className={`inline-flex items-center min-h-[44px] px-3 rounded border ${
              filter === s
                ? 'border-sky-700 bg-sky-900/40 text-sky-200'
                : 'border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            {s}
          </Link>
        ))}
        {distinctMailboxes.length > 1 || mailboxFilter ? (
          <div className="ml-2 flex items-center gap-2">
            <span className="text-slate-500">mailbox:</span>
            <Link
              href={buildHref({ mailbox: null })}
              className={`inline-flex items-center min-h-[44px] px-3 rounded border ${
                mailboxFilter === null
                  ? 'border-sky-700 bg-sky-900/40 text-sky-200'
                  : 'border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >
              all
            </Link>
            {distinctMailboxes.map((m) => (
              <Link
                key={m}
                href={buildHref({ mailbox: m })}
                className={`px-3 py-1 rounded border font-mono ${
                  mailboxFilter === m
                    ? 'border-sky-700 bg-sky-900/40 text-sky-200'
                    : 'border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                {m}
              </Link>
            ))}
          </div>
        ) : null}
      </nav>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
          No emails matching status={filter} mailbox={mailboxFilter ?? 'any'}.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-800 overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-3 py-2">Sent</th>
                <th className="text-left px-3 py-2 hidden md:table-cell">Mailbox</th>
                <th className="text-left px-3 py-2">To</th>
                <th className="text-left px-3 py-2 hidden lg:table-cell">Subject</th>
                <th className="text-left px-3 py-2 hidden lg:table-cell">Purpose</th>
                <th className="text-left px-3 py-2 hidden lg:table-cell">Provider</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2 hidden lg:table-cell">External ID</th>
                <th className="text-left px-3 py-2 hidden md:table-cell">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((r) => {
                const sentAt = r.sentAt ? new Date(r.sentAt) : null;
                return (
                  <tr key={r.id} className="hover:bg-slate-900/40 align-top">
                    <td
                      className="px-3 py-2 text-xs text-slate-300 whitespace-nowrap"
                      title={sentAt ? sentAt.toISOString() : ''}
                    >
                      {sentAt ? formatRelative(sentAt) : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-300 hidden md:table-cell">
                      {r.mailbox}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-300 break-words">
                      {r.toAddress}
                      <div className="text-[10px] text-slate-500 md:hidden">{r.mailbox}</div>
                    </td>
                    <td
                      className="px-3 py-2 text-xs text-slate-200 max-w-sm hidden lg:table-cell"
                      title={r.subject}
                    >
                      {truncate(r.subject, 80)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400 hidden lg:table-cell">{r.purpose}</td>
                    <td className="px-3 py-2 text-xs text-slate-400 hidden lg:table-cell">{r.provider}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td
                      className="px-3 py-2 font-mono text-xs text-slate-400 max-w-[12rem] truncate hidden lg:table-cell"
                      title={r.externalId ?? ''}
                    >
                      {r.externalId ? truncate(r.externalId, 24) : '—'}
                    </td>
                    <td
                      className="px-3 py-2 text-xs text-red-300/80 max-w-xs hidden md:table-cell"
                      title={r.errorMessage ?? ''}
                    >
                      {r.errorMessage ? truncate(r.errorMessage, 80) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 14) return `${d}d ago`;
  return date.toLocaleDateString();
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'sent'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : status === 'throttled'
      ? 'bg-amber-900/30 text-amber-300 border-amber-700/50'
      : status === 'failed'
      ? 'bg-red-900/40 text-red-300 border-red-700/50'
      : 'bg-slate-800/60 text-slate-300 border-slate-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{status}</span>
  );
}
