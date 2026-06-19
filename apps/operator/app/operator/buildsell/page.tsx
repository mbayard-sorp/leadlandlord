import { desc } from 'drizzle-orm';
import { getDb, buildsellSites, listWorkedLeads } from '@leadlandlord/db';
import type { BuildsellLead } from '@leadlandlord/db';
import { SearchPanel } from './SearchPanel';
import { BuildSellButtons } from './BuildSellButtons';

export const dynamic = 'force-dynamic';

/** YYYY-MM-DD string from a Date, in the local (server) timezone. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today's date as YYYY-MM-DD (UTC, consistent with how followUpAt is stored). */
function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function BuildSellPage() {
  const db = getDb();
  const [rows, worked] = await Promise.all([
    db.select().from(buildsellSites).orderBy(desc(buildsellSites.createdAt)),
    listWorkedLeads(),
  ]);

  const today = todayYmd();

  // Preview/Live links resolve to the site-host Vercel project, not operator.
  // A relative `/preview/...` would 404 against the operator domain.
  const siteHost =
    process.env.NEXT_PUBLIC_SITES_PREVIEW_HOST ?? 'leadlandlord-sites.vercel.app';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl md:text-2xl font-semibold">Build &amp; Sell</h1>
        <p className="text-sm text-slate-400 mt-1">
          Find no-website businesses via Google Places, create a draft spec site, send an invoice,
          and flip it live once paid.
        </p>
      </header>

      <SearchPanel />

      {/* Follow-ups & worked leads board */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-2 text-slate-300">
          Follow-ups &amp; worked leads ({worked.length})
        </h2>
        {worked.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/20 p-4 text-sm text-slate-500">
            No leads worked yet — search above and mark calls as you go.
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-slate-800 bg-slate-900/40">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                  <Th>Business</Th>
                  <Th>Phone</Th>
                  <Th>Location</Th>
                  <Th>Website</Th>
                  <Th>Called</Th>
                  <Th>Follow-up</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody>
                {worked.map((lead) => (
                  <WorkedLeadRow key={lead.placeId} lead={lead} today={today} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Sites list */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-2 text-slate-300">
          Sites ({rows.length})
        </h2>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/20 p-4 text-sm text-slate-500">
            No B&amp;S sites yet. Use the search panel above to find leads and create a draft.
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0 rounded-lg border border-slate-800 bg-slate-900/40">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                  <Th>Business</Th>
                  <Th>Location</Th>
                  <Th>Trade</Th>
                  <Th>Status</Th>
                  <Th>Price</Th>
                  <Th>Preview</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((site) => (
                  <tr
                    key={site.id}
                    className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20"
                  >
                    <td className="px-2 py-2 font-medium text-slate-200">{site.businessName}</td>
                    <td className="px-2 py-2 text-slate-400">
                      {site.city}, {site.state}
                    </td>
                    <td className="px-2 py-2 text-slate-400">{site.trade}</td>
                    <td className="px-2 py-2">
                      <StatusBadge status={site.status} />
                    </td>
                    <td className="px-2 py-2 text-slate-400">
                      {site.priceUsd ? `$${Number(site.priceUsd).toFixed(0)}` : '—'}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-col gap-1">
                        <a
                          href={`https://${siteHost}/preview/${site.slug ?? site.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-sky-400 hover:text-sky-300 underline"
                        >
                          Preview
                        </a>
                        {site.status === 'live' && site.slug && (
                          <a
                            href={`https://${siteHost}/buildsell/${site.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-emerald-400 hover:text-emerald-300 underline"
                          >
                            Live
                          </a>
                        )}
                        <a
                          href={`/operator/buildsell/${site.id}`}
                          className="text-xs text-slate-400 hover:text-slate-200 underline"
                        >
                          Detail
                        </a>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <BuildSellButtons site={site} />
                    </td>
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

function WorkedLeadRow({ lead, today }: { lead: BuildsellLead; today: string }) {
  const followUpYmd = lead.followUpAt ? ymd(lead.followUpAt) : null;
  const isOverdue = followUpYmd !== null && followUpYmd <= today;

  const rowCls = isOverdue
    ? 'border-b border-slate-800/50 last:border-0 bg-red-950/20'
    : 'border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20';

  return (
    <tr className={rowCls}>
      <td className="px-2 py-2 font-medium text-slate-200">
        {lead.displayName ?? <span className="text-slate-600 italic">(name reaped)</span>}
      </td>
      <td className="px-2 py-2 text-slate-400 whitespace-nowrap">
        {lead.nationalPhone ?? '—'}
      </td>
      <td className="px-2 py-2 text-slate-400 whitespace-nowrap">
        {lead.city && lead.state ? `${lead.city}, ${lead.state}` : lead.city ?? lead.state ?? '—'}
      </td>
      <td className="px-2 py-2">
        {lead.websiteUri ? (
          <a
            href={lead.websiteUri}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-sky-400 hover:text-sky-300 underline truncate max-w-[140px] block"
          >
            {lead.websiteUri.replace(/^https?:\/\//, '')}
          </a>
        ) : (
          <span className="text-xs text-emerald-400">no site</span>
        )}
      </td>
      <td className="px-2 py-2 whitespace-nowrap">
        {lead.called ? (
          <span className="text-xs text-emerald-400">
            Called{lead.calledAt ? ` ${new Date(lead.calledAt).toLocaleDateString()}` : ''}
          </span>
        ) : (
          <span className="text-xs text-slate-600">—</span>
        )}
      </td>
      <td className="px-2 py-2 whitespace-nowrap">
        {followUpYmd ? (
          <span
            className={`text-xs font-medium ${
              isOverdue ? 'text-red-400' : 'text-amber-300'
            }`}
          >
            {followUpYmd}
            {isOverdue && (
              <span className="ml-1 inline-block rounded px-1 py-0.5 text-xs bg-red-900/50 text-red-300">
                Due
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-slate-600">—</span>
        )}
      </td>
      <td className="px-2 py-2 max-w-[200px]">
        {lead.note ? (
          <span className="text-xs text-slate-400 line-clamp-2" title={lead.note}>
            {lead.note}
          </span>
        ) : (
          <span className="text-xs text-slate-700">—</span>
        )}
      </td>
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-2 font-medium">{children}</th>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-slate-700 text-slate-300',
    building: 'bg-amber-900/60 text-amber-300',
    invoiced: 'bg-blue-900/60 text-blue-300',
    paid: 'bg-purple-900/60 text-purple-300',
    live: 'bg-emerald-900/60 text-emerald-300',
    failed: 'bg-red-900/60 text-red-300',
  };
  const cls = map[status] ?? 'bg-slate-700 text-slate-300';
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}
