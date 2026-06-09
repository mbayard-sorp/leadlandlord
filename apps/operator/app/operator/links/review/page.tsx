import Link from 'next/link';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getDb, backlinkProspects, sites } from '@leadlandlord/db';
import { ReviewSession } from './ReviewSession';

export const dynamic = 'force-dynamic';

export default async function ReviewSessionPage() {
  const db = getDb();

  // Load all flagged_top5 prospects, not snoozed
  const [rows, allSites] = await Promise.all([
    db
      .select()
      .from(backlinkProspects)
      .where(eq(backlinkProspects.status, 'flagged_top5'))
      .orderBy(desc(backlinkProspects.flaggedTop5At))
      .limit(100),
    db
      .select({ id: sites.id, niche: sites.niche, city: sites.city, state: sites.state })
      .from(sites),
  ]);

  const siteMap = new Map(allSites.map((s) => [s.id, s]));
  const now = new Date();

  // Filter out snoozed prospects server-side
  const notSnoozed = rows.filter((r) => {
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    const snoozedUntil = typeof md.snoozedUntil === 'string' ? new Date(md.snoozedUntil) : null;
    return !snoozedUntil || snoozedUntil <= now;
  });

  const prospects = notSnoozed.map((r) => {
    const site = siteMap.get(r.siteId);
    const siteLabel = site
      ? `${site.niche} — ${site.city}, ${site.state}`
      : r.siteId.slice(0, 8);
    return { ...r, siteLabel };
  });

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-semibold">Prospect review</h1>
          <p className="text-sm text-slate-400 mt-1">
            One at a time — approve, snooze, or reject each Molly pick.
          </p>
        </div>
        <Link
          href="/operator/links"
          className="shrink-0 text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:border-slate-500 whitespace-nowrap"
        >
          ← Back to hub
        </Link>
      </header>

      <ReviewSession prospects={prospects} />
    </div>
  );
}
