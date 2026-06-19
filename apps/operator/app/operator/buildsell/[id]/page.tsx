import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, buildsellSites } from '@leadlandlord/db';
import { createWriteClient } from '@leadlandlord/integrations/sanity';
import { buildsellSiteDocId } from '@leadlandlord/sanity-schema/ids';
import { BuildSellImagePanel } from '../BuildSellImagePanel';
import { MigrationReviewPanel } from '../MigrationReviewPanel';
import { BuildSellRevisePanel } from '../BuildSellRevisePanel';
import { BuildSellRegeneratePanel } from '../BuildSellRegeneratePanel';
import { PENDING_MIGRATION_KEY, type PendingMigration } from '@leadlandlord/agents/content-migrator/types';

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

  const meta = (site.metadata ?? {}) as Record<string, unknown>;
  // Pending content-migration suggestions (staged by the content-migrator agent).
  const pendingMigration = (meta[PENDING_MIGRATION_KEY] as PendingMigration | undefined) ?? null;
  // Last clarification (if any) for the revise panel — stored in metadata jsonb.
  const lastClarifyingPrompt =
    meta.lastClarifyingPrompt && typeof meta.lastClarifyingPrompt === 'object'
      ? (meta.lastClarifyingPrompt as { prompt: string; revisedAt: string })
      : null;

  // Preview/Live links resolve to the site-host Vercel project, not operator.
  // A relative `/preview/...` would 404 against the operator domain.
  const siteHost =
    process.env.NEXT_PUBLIC_SITES_PREVIEW_HOST ?? 'leadlandlord-sites.vercel.app';

  // Sign the preview URL so the buyer's "Save my theme" POST can be authorized
  // by site-host. The token is HMAC-SHA256 over `bs-theme:${id}` using
  // BS_PREVIEW_HMAC_SECRET. If the secret is unset we fall back to the plain
  // preview URL — the page still works, Save just won't authorize.
  // NOTE: BS_PREVIEW_HMAC_SECRET must also be set in the site-host Vercel
  // project (same value) — the verifier there mirrors this exact signing call.
  // Path uses the human-readable slug once the build has populated it; falls
  // back to the UUID for sites mid-build. The HMAC token stays keyed on the
  // UUID (site.id) — the theme-save endpoint and verifier are UUID-based and
  // are unaffected by which form the path takes.
  const previewPath = site.slug ?? site.id;
  const hmacSecret = process.env.BS_PREVIEW_HMAC_SECRET;
  let previewUrl: string;
  if (hmacSecret) {
    const token = createHmac('sha256', hmacSecret).update(`bs-theme:${site.id}`).digest('hex');
    previewUrl = `https://${siteHost}/preview/${previewPath}?t=${token}`;
  } else {
    console.warn('[buildsell] BS_PREVIEW_HMAC_SECRET is not set — preview link is unsigned; buyer Save will not authorize');
    previewUrl = `https://${siteHost}/preview/${previewPath}`;
  }

  // Fetch theme-lock status from the Sanity doc. Non-fatal — if the doc doesn't
  // exist yet (build still in progress) we show "not built" gracefully.
  type ThemeSnap = {
    themeLocked?: boolean;
    theme?: {
      preset?: string;
      layoutVariant?: string;
      fontHeading?: string;
      fontBody?: string;
    };
  };
  let themeSnap: ThemeSnap | null = null;
  try {
    const client = createWriteClient();
    themeSnap = await client.fetch<ThemeSnap | null>(
      `*[_id==$id][0]{ themeLocked, theme{ preset, layoutVariant, fontHeading, fontBody } }`,
      { id: buildsellSiteDocId(site.id) },
    );
  } catch {
    // Non-fatal — Sanity may be transiently unavailable or doc not yet created.
  }

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
          href={previewUrl}
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

      {/* Buyer theme-lock status */}
      <section className="rounded-lg border border-slate-700/60 bg-slate-800/40 px-4 py-3 text-sm space-y-1">
        <p className="font-medium text-slate-300">Buyer theme selection</p>
        {themeSnap === null ? (
          <p className="text-slate-500 text-xs">Site doc not yet built — theme status unavailable.</p>
        ) : themeSnap.themeLocked ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-emerald-400">
            <span>Buyer locked theme: &#10003;</span>
            {themeSnap.theme?.preset && (
              <span className="text-slate-300">Preset: <span className="font-medium">{themeSnap.theme.preset}</span></span>
            )}
            {themeSnap.theme?.layoutVariant && (
              <span className="text-slate-300">Layout: <span className="font-medium">{themeSnap.theme.layoutVariant}</span></span>
            )}
            {themeSnap.theme?.fontHeading && (
              <span className="text-slate-300">Heading font: <span className="font-medium">{themeSnap.theme.fontHeading}</span></span>
            )}
            {themeSnap.theme?.fontBody && (
              <span className="text-slate-300">Body font: <span className="font-medium">{themeSnap.theme.fontBody}</span></span>
            )}
          </div>
        ) : (
          <div className="space-y-0.5">
            <p className="text-amber-400">Buyer has not locked a theme yet.</p>
            {themeSnap.theme && (
              <p className="text-slate-500 text-xs">
                Current generated theme:{' '}
                {[
                  themeSnap.theme.preset && `preset: ${themeSnap.theme.preset}`,
                  themeSnap.theme.layoutVariant && `layout: ${themeSnap.theme.layoutVariant}`,
                  themeSnap.theme.fontHeading && `heading: ${themeSnap.theme.fontHeading}`,
                  themeSnap.theme.fontBody && `body: ${themeSnap.theme.fontBody}`,
                ].filter(Boolean).join(' / ')}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Content migration review queue */}
      <MigrationReviewPanel
        siteId={site.id}
        pending={pendingMigration}
        canCrawl={!isPaidOrLive}
      />

      {/* Last build error — shown when the most recent build attempt failed */}
      {site.lastBuildError && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300 space-y-1">
          <p className="font-semibold">Last build error</p>
          <pre className="text-xs text-red-400/80 whitespace-pre-wrap break-words font-mono">
            {site.lastBuildError}
          </pre>
        </div>
      )}

      {/* Copy revision — hidden on sold/indexed sites */}
      {!isPaidOrLive && (
        <BuildSellRevisePanel siteId={site.id} lastPrompt={lastClarifyingPrompt} />
      )}

      {/* Full site regeneration — hidden on sold/indexed sites */}
      {!isPaidOrLive && (
        <BuildSellRegeneratePanel siteId={site.id} />
      )}

      {/* Image prompt control panel */}
      <BuildSellImagePanel siteId={site.id} />
    </div>
  );
}
