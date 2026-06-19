import { notFound } from 'next/navigation';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getDb, buildsellSites } from '@leadlandlord/db';
import { BuildSellImagePanel } from '../BuildSellImagePanel';
import { BuildSellRevisePanel } from '../BuildSellRevisePanel';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export default async function BuildSellDetailPage({ params }: Params) {
  const { id } = await params;

  const db = getDb();
  const [site] = await db
    .select()
    .from(buildsellSites)
    .where(eq(buildsellSites.id, id))
    .limit(1);

  if (!site) notFound();

  const isPaidOrLive = site.status === 'paid' || site.status === 'live';

  // Last clarification (if any) for the revise panel — stored in metadata jsonb.
  const meta = (site.metadata ?? {}) as Record<string, unknown>;
  const lastClarifyingPrompt =
    meta.lastClarifyingPrompt && typeof meta.lastClarifyingPrompt === 'object'
      ? (meta.lastClarifyingPrompt as { prompt: string; revisedAt: string })
      : null;

  // Preview/Live links resolve to the site-host Vercel project, not operator.
  // A relative `/preview/...` would 404 against the operator domain.
  const siteHost =
    process.env.NEXT_PUBLIC_SITES_PREVIEW_HOST ?? 'leadlandlord-sites.vercel.app';

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <header className="flex items-start gap-3">
        <Link
          href="/operator/buildsell"
          className="mt-0.5 text-xs text-slate-500 hover:text-slate-300 shrink-0"
        >
          &larr; Back
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-slate-100">{site.businessName}</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {site.city}, {site.state} &middot; {site.trade} &middot;{' '}
            <span className="font-medium capitalize">{site.status}</span>
          </p>
        </div>
      </header>

      {/* Rebuild-clobber notice */}
      {isPaidOrLive && (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300 space-y-1">
          <p className="font-semibold">Paid / live site — rebuild is blocked.</p>
          <p className="text-amber-400/80">
            Rebuilding a paid or live site via the cron would overwrite{' '}
            <code className="text-xs bg-amber-900/40 px-1 rounded">draftMode</code>,{' '}
            <code className="text-xs bg-amber-900/40 px-1 rounded">robotsDisallow</code>, and{' '}
            <code className="text-xs bg-amber-900/40 px-1 rounded">purchaseUrl</code> — silently
            de-indexing the live site. The cron will never rebuild a paid or live site without an
            explicit operator override. Image-prompt edits you make here are preserved on any future
            approved rebuild via read-merge.
          </p>
        </div>
      )}

      {/* Quick links */}
      <section className="flex flex-wrap gap-3 text-sm">
        <a
          href={`https://${siteHost}/preview/${site.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 hover:text-sky-300 underline"
        >
          Preview
        </a>
        {site.status === 'live' && site.slug && (
          <a
            href={`https://${siteHost}/buildsell/${site.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-400 hover:text-emerald-300 underline"
          >
            Live site
          </a>
        )}
        {site.paymentLink && (
          <a
            href={site.paymentLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-400 hover:text-purple-300 underline"
          >
            Payment link
          </a>
        )}
      </section>

      {/* Copy revision — hidden on sold/indexed sites */}
      {!isPaidOrLive && (
        <BuildSellRevisePanel siteId={site.id} lastPrompt={lastClarifyingPrompt} />
      )}

      {/* Image prompt control panel */}
      <BuildSellImagePanel siteId={site.id} />
    </div>
  );
}
