/**
 * Leads inbox — read-only table of contact submissions for this site.
 *
 * Auth: `requireCustomerSiteAccess(id)` is called first — fail-closed.
 * The guard throws before any DB read if the user lacks an active access row.
 *
 * Query: buildsell_site_leads WHERE buildsell_site_id = id
 *        ORDER BY created_at DESC LIMIT 200
 *
 * READ-ONLY — no edit, delete, or status controls.
 */

import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@leadlandlord/db/client';
import { buildsellSiteLeads, buildsellSites } from '@leadlandlord/db/schema';
import { requireCustomerSiteAccess, UnauthorizedError } from '@/lib/auth-guard';
import SiteNav from '@/components/SiteNav';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusBadge(status: string | null) {
  const label = status ?? 'pending';
  const colorMap: Record<string, { bg: string; color: string }> = {
    sent:    { bg: 'rgb(220 252 231)', color: 'var(--color-success)' },
    pending: { bg: 'rgb(254 249 195)', color: 'var(--color-warn)' },
    skipped: { bg: 'rgb(241 245 249)', color: 'var(--color-muted)' },
    failed:  { bg: 'rgb(254 226 226)', color: 'var(--color-error)' },
  };
  const style = colorMap[label] ?? colorMap['skipped']!;
  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded"
      style={{ background: style.bg, color: style.color }}
    >
      {label}
    </span>
  );
}

export default async function LeadsPage({ params }: Props) {
  const { id } = await params;

  // 1. Auth — fail-closed. Called before any DB read.
  try {
    await requireCustomerSiteAccess(id);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect('/login');
    }
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-fg)' }}>
            Access denied
          </h1>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            You do not have access to this site.
          </p>
          <a href="/dashboard" className="inline-block mt-4 text-sm" style={{ color: 'var(--color-accent)' }}>
            Back to dashboard
          </a>
        </div>
      </main>
    );
  }

  const db = getDb();

  // 2. Load site row for the nav header.
  const [siteRow] = await db
    .select({ businessName: buildsellSites.businessName })
    .from(buildsellSites)
    .where(eq(buildsellSites.id, id))
    .limit(1);

  // 3. Query leads — scoped to this site, newest first, capped at 200.
  const leads = await db
    .select({
      id: buildsellSiteLeads.id,
      name: buildsellSiteLeads.name,
      phone: buildsellSiteLeads.phone,
      email: buildsellSiteLeads.email,
      message: buildsellSiteLeads.message,
      forwardStatus: buildsellSiteLeads.forwardStatus,
      createdAt: buildsellSiteLeads.createdAt,
    })
    .from(buildsellSiteLeads)
    .where(eq(buildsellSiteLeads.buildsellSiteId, id))
    .orderBy(desc(buildsellSiteLeads.createdAt))
    .limit(200);

  const businessName = siteRow?.businessName ?? 'Site';

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <SiteNav siteId={id} businessName={businessName} activeSection="leads" />

      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-fg)' }}>
              Leads
            </h2>
            {leads.length > 0 && (
              <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
                {leads.length} {leads.length === 1 ? 'lead' : 'leads'}
                {leads.length === 200 ? ' (showing latest 200)' : ''}
              </span>
            )}
          </div>

          {leads.length === 0 ? (
            <div
              className="flex items-center justify-center py-20 rounded-lg border"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}
            >
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                No leads yet — they&apos;ll appear here as visitors contact you.
              </p>
            </div>
          ) : (
            <div
              className="rounded-lg border overflow-hidden"
              style={{ borderColor: 'var(--color-border)' }}
            >
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr
                      style={{
                        background: 'var(--color-panel)',
                        borderBottom: '1px solid var(--color-border)',
                      }}
                    >
                      {(['Date', 'Name', 'Phone', 'Email', 'Message', 'Status'] as const).map((col) => (
                        <th
                          key={col}
                          className="px-4 py-3 text-left text-xs font-medium"
                          style={{ color: 'var(--color-muted)' }}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead, i) => (
                      <tr
                        key={lead.id}
                        style={{
                          background: i % 2 === 0 ? 'var(--color-panel)' : 'var(--color-bg)',
                          borderBottom: '1px solid var(--color-border)',
                        }}
                      >
                        <td
                          className="px-4 py-3 whitespace-nowrap text-xs"
                          style={{ color: 'var(--color-muted)' }}
                        >
                          {formatDate(lead.createdAt)}
                        </td>
                        <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-fg)' }}>
                          {lead.name ?? <span style={{ color: 'var(--color-muted)' }}>—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {lead.phone ? (
                            <a
                              href={`tel:${lead.phone}`}
                              style={{ color: 'var(--color-accent)' }}
                            >
                              {lead.phone}
                            </a>
                          ) : (
                            <span style={{ color: 'var(--color-muted)' }}>—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {lead.email ? (
                            <a
                              href={`mailto:${lead.email}`}
                              style={{ color: 'var(--color-accent)' }}
                            >
                              {lead.email}
                            </a>
                          ) : (
                            <span style={{ color: 'var(--color-muted)' }}>—</span>
                          )}
                        </td>
                        <td
                          className="px-4 py-3 max-w-xs"
                          style={{ color: 'var(--color-fg)' }}
                        >
                          {lead.message ? (
                            <span className="line-clamp-2 text-xs">{lead.message}</span>
                          ) : (
                            <span style={{ color: 'var(--color-muted)' }}>—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {statusBadge(lead.forwardStatus)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <ul className="md:hidden divide-y" style={{ borderColor: 'var(--color-border)' }}>
                {leads.map((lead) => (
                  <li
                    key={lead.id}
                    className="p-4 space-y-1.5"
                    style={{ background: 'var(--color-panel)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm" style={{ color: 'var(--color-fg)' }}>
                        {lead.name ?? 'Unknown'}
                      </span>
                      {statusBadge(lead.forwardStatus)}
                    </div>
                    {lead.phone && (
                      <p className="text-xs">
                        <a href={`tel:${lead.phone}`} style={{ color: 'var(--color-accent)' }}>
                          {lead.phone}
                        </a>
                      </p>
                    )}
                    {lead.email && (
                      <p className="text-xs">
                        <a href={`mailto:${lead.email}`} style={{ color: 'var(--color-accent)' }}>
                          {lead.email}
                        </a>
                      </p>
                    )}
                    {lead.message && (
                      <p className="text-xs line-clamp-3" style={{ color: 'var(--color-muted)' }}>
                        {lead.message}
                      </p>
                    )}
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {formatDate(lead.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
