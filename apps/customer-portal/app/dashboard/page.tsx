/**
 * Customer dashboard — server component.
 *
 * Reads the current user's accessible sites via listAccessibleSites(), which
 * joins bs_customer_site_access -> buildsell_sites scoped to the current user.
 * Never lists sites the user has no active access row for.
 *
 * Single-site customers are redirected straight to their editor.
 */

import { redirect } from 'next/navigation';
import { count, inArray } from 'drizzle-orm';
import { getDb } from '@leadlandlord/db/client';
import { buildsellSiteLeads } from '@leadlandlord/db/schema';
import { getCurrentUser } from '@/lib/auth';
import { listAccessibleSites } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const sites = await listAccessibleSites();

  // Fetch lead counts for all accessible sites in one grouped query.
  const leadCountMap: Record<string, number> = {};
  if (sites.length > 0) {
    const db = getDb();
    const siteIds = sites.map((s) => s.id);
    const rows = await db
      .select({
        siteId: buildsellSiteLeads.buildsellSiteId,
        leadCount: count(),
      })
      .from(buildsellSiteLeads)
      .where(inArray(buildsellSiteLeads.buildsellSiteId, siteIds))
      .groupBy(buildsellSiteLeads.buildsellSiteId);
    for (const row of rows) {
      leadCountMap[row.siteId] = Number(row.leadCount);
    }
  }

  if (sites.length === 0) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-fg)' }}>
            No sites yet
          </h1>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            Your site will appear here once it has been set up.
          </p>
        </div>
      </main>
    );
  }

  // Single-site shortcut — go straight to the editor.
  if (sites.length === 1 && sites[0]) {
    redirect(`/sites/${sites[0].id}/edit`);
  }

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--color-fg)' }}>
        Your sites
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--color-muted)' }}>
        Select a site to edit its content.
      </p>

      <ul className="space-y-3">
        {sites.map((site) => (
          <li key={site.id}>
            <a
              href={`/sites/${site.id}/edit`}
              className="flex items-center justify-between p-4 rounded-lg border transition-colors hover:border-blue-500"
              style={{
                background: 'var(--color-panel)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-fg)',
              }}
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{site.businessName}</p>
                {site.slug && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                    /{site.slug}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                {(leadCountMap[site.id] ?? 0) > 0 && (
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded"
                    style={{ background: 'rgb(219 234 254)', color: 'var(--color-accent)' }}
                  >
                    {leadCountMap[site.id]} {leadCountMap[site.id] === 1 ? 'lead' : 'leads'}
                  </span>
                )}
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded"
                  style={{
                    background:
                      site.status === 'live'
                        ? 'rgb(220 252 231)'
                        : 'rgb(241 245 249)',
                    color:
                      site.status === 'live'
                        ? 'var(--color-success)'
                        : 'var(--color-muted)',
                  }}
                >
                  {site.status}
                </span>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
