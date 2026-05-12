import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { Marked } from 'marked';
import { getDb, backlinks, sites, tenants } from '@leadlandlord/db';
import { DraftReviewActions } from './DraftReviewActions';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

const marked = new Marked({ gfm: true, breaks: false, async: false });

export default async function DraftReviewPage({ params }: PageProps) {
  const { id } = await params;
  const db = getDb();
  const [row] = await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1);
  if (!row) notFound();
  const [site] = await db.select().from(sites).where(eq(sites.id, row.siteId)).limit(1);
  const tenant = site?.tenantId
    ? (await db.select().from(tenants).where(eq(tenants.id, site.tenantId)).limit(1))[0] ?? null
    : null;

  const md = (row.metadata ?? {}) as Record<string, unknown>;
  const anchorText = typeof md.anchorText === 'string' ? md.anchorText : null;
  const wordCount = typeof md.draftWordCount === 'number' ? md.draftWordCount : null;
  const anchorIndex = typeof md.anchorParagraphIndex === 'number' ? md.anchorParagraphIndex : null;
  const voiceSource = typeof md.voiceSource === 'string' ? md.voiceSource : null;
  const draftRejection = md.draftRejection as
    | { reason: string; at: string }
    | undefined;

  const hasDraft = typeof row.draftMarkdown === 'string' && row.draftMarkdown.trim().length > 0;
  const previewHtml = hasDraft
    ? (marked.parse(highlightAnchor(row.draftMarkdown!, anchorText)) as string)
    : null;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Draft review</h1>
          <p className="text-sm text-slate-400 mt-1">
            Guest-post draft for{' '}
            <span className="font-mono text-slate-300">{row.sourceDomain}</span>
            {site ? ` · ${site.niche} — ${site.city}, ${site.state}` : null}
            {tenant ? ` · ${tenant.businessName}` : null}
          </p>
        </div>
        <Link
          href="/operator/backlinks?status=draft_pending_review"
          className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:border-slate-500"
        >
          ← Back to queue
        </Link>
      </header>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-sm">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <Stat label="Status" value={row.status} mono />
          <Stat label="Anchor type" value={row.anchorType ?? '—'} mono />
          <Stat label="Anchor text" value={anchorText ?? '—'} mono />
          <Stat label="Word count" value={wordCount != null ? String(wordCount) : '—'} mono />
          <Stat
            label="Anchor paragraph"
            value={anchorIndex != null && anchorIndex > 0 ? `#${anchorIndex}` : 'not found'}
            mono
            warn={anchorIndex === 0}
          />
          <Stat label="Voice source" value={voiceSource ?? '—'} mono />
          <Stat
            label="Word range OK"
            value={wordCount != null && wordCount >= 1000 && wordCount <= 1500 ? 'yes' : 'flag'}
            mono
            warn={wordCount != null && (wordCount < 1000 || wordCount > 1500)}
          />
        </div>
        {draftRejection ? (
          <div className="mt-3 rounded border border-red-700/40 bg-red-900/20 p-2 text-xs text-red-200">
            <span className="font-semibold">Prior rejection</span>{' '}
            <span className="text-red-300/80">
              ({new Date(draftRejection.at).toLocaleString()})
            </span>
            <div className="mt-1 text-red-100/90">{draftRejection.reason}</div>
          </div>
        ) : null}
      </section>

      {hasDraft ? (
        <>
          <article
            className="prose-site rounded-lg border border-slate-800 bg-slate-900/30 p-6"
            dangerouslySetInnerHTML={{ __html: previewHtml! }}
          />
          <DraftReviewActions id={row.id} status={row.status} />
        </>
      ) : row.status === 'accepted' ? (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center text-sm text-slate-400 space-y-3">
          <div>No draft yet. The agent will pick this up on the next operator-tick.</div>
          <DraftReviewActions id={row.id} status={row.status} />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
          No draft and current status is{' '}
          <span className="font-mono">{row.status}</span> — nothing to review here.
        </div>
      )}
    </div>
  );
}

function Stat({
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
      <div className="text-slate-500 uppercase tracking-wide">{label}</div>
      <div
        className={`${mono ? 'font-mono' : ''} ${warn ? 'text-amber-300' : 'text-slate-200'}`}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Wrap the anchor text in a sentinel `<mark>` so the rendered HTML
 * highlights where the link lives in the preview. Marked passes inline
 * HTML through by default with GFM, so this works without raw-html
 * escaping concerns (the operator UI is trusted internal-only).
 *
 * Only wraps the FIRST occurrence — duplicate anchor planting is exactly
 * what R4.6 will validate against, so seeing one highlighted marker
 * already tells us if Sonnet over-planted.
 */
function highlightAnchor(md: string, anchor: string | null): string {
  if (!anchor) return md;
  const idx = md.indexOf(anchor);
  if (idx < 0) return md;
  return `${md.slice(0, idx)}<mark>${anchor}</mark>${md.slice(idx + anchor.length)}`;
}
