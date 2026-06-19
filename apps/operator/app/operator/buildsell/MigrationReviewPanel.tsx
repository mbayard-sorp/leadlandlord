'use client';

import { useState, useTransition } from 'react';
import { crawlExistingSite, applyMigrationSelections, rejectMigration } from './actions';
import type {
  PendingMigration,
  MigrationSelections,
} from '@leadlandlord/agents/content-migrator/types';

interface Props {
  siteId: string;
  /** The pending review blob from buildsell_sites.metadata.pendingMigration. */
  pending: PendingMigration | null;
  /** False when status is paid/live (crawl disabled). */
  canCrawl: boolean;
}

/**
 * Operator review queue for content migrated from a prospect's existing site.
 *
 * The content-migrator agent stages suggestions on the draft; the operator
 * approves/edits each item here. Apply patches the live Sanity doc + records a
 * durable overlay (preserved on rebuild). Nothing is applied without approval.
 */
export function MigrationReviewPanel({ siteId, pending, canCrawl }: Props) {
  const [crawling, startCrawl] = useTransition();
  const [applying, startApply] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const isPending = pending?.status === 'pending';
  const s = pending?.suggestions;

  // Approval toggles + editable copy.
  const [approve, setApprove] = useState<Record<string, boolean>>({});
  const [headline, setHeadline] = useState(s?.headline ?? '');
  const [aboutBody, setAboutBody] = useState(s?.aboutBody ?? '');

  const toggle = (k: string) => setApprove((p) => ({ ...p, [k]: !p[k] }));

  function handleCrawl() {
    setMsg(null);
    startCrawl(async () => {
      const r = await crawlExistingSite(siteId);
      setMsg(r.message ?? (r.ok ? 'Queued.' : 'Failed.'));
    });
  }

  function handleApply() {
    if (!s) return;
    const sel: MigrationSelections = {};
    if (approve.headline && headline.trim()) sel.headline = headline.trim();
    if (approve.aboutBody && aboutBody.trim()) sel.aboutBody = aboutBody.trim();
    if (approve.services && s.services?.length) sel.services = s.services;
    if (approve.socials && s.socials?.length) sel.socials = s.socials;
    if (approve.logo && s.logo) sel.logo = s.logo;
    if (approve.heroImage && s.heroImage) sel.heroImage = s.heroImage;
    if (approve.aboutImage && s.aboutImage) sel.aboutImage = s.aboutImage;
    if (approve.ugc && s.ugc?.length) sel.ugc = s.ugc;

    if (Object.keys(sel).length === 0) {
      setMsg('Select at least one item to apply.');
      return;
    }
    setMsg(null);
    startApply(async () => {
      const r = await applyMigrationSelections(siteId, sel);
      setMsg(r.message ?? (r.ok ? 'Applied.' : 'Failed.'));
    });
  }

  function handleReject() {
    setMsg(null);
    startApply(async () => {
      const r = await rejectMigration(siteId);
      setMsg(r.message ?? (r.ok ? 'Discarded.' : 'Failed.'));
    });
  }

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Migrate existing site
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Crawl the prospect&apos;s current website and pull in their real logo, photos, copy, and
          social links. Approve each item below; nothing is applied without your approval. Approved
          content is preserved on rebuild.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleCrawl}
          disabled={crawling || !canCrawl}
          className="px-3 py-1.5 rounded border border-slate-700 bg-slate-900/60 text-slate-200 text-xs hover:bg-slate-800 disabled:opacity-50"
          title={canCrawl ? 'Crawl the existing website' : 'Crawling is disabled for paid/live sites'}
        >
          {crawling ? 'Queuing…' : isPending ? 'Re-crawl existing site' : 'Crawl existing site'}
        </button>
        {pending?.source && (
          <span className="text-xs text-slate-500 break-all">source: {pending.source}</span>
        )}
      </div>

      {msg && <p className="text-xs text-sky-300 break-all">{msg}</p>}

      {!isPending && (
        <p className="text-xs text-slate-500">
          {pending?.status === 'applied'
            ? 'Migration applied. Re-crawl to fetch fresh suggestions.'
            : pending?.status === 'rejected'
              ? 'Suggestions discarded. Re-crawl to try again.'
              : 'No suggestions yet. Crawl the existing site to fetch some.'}
        </p>
      )}

      {isPending && s && (
        <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          {/* Headline */}
          {s.headline != null && (
            <Row label="Hero headline" approved={!!approve.headline} onToggle={() => toggle('headline')}>
              <input
                className="w-full rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-sm text-slate-200"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
              />
            </Row>
          )}

          {/* About body */}
          {s.aboutBody != null && (
            <Row label="About copy" approved={!!approve.aboutBody} onToggle={() => toggle('aboutBody')}>
              <textarea
                className="w-full rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-sm text-slate-200 resize-y"
                rows={3}
                value={aboutBody}
                onChange={(e) => setAboutBody(e.target.value)}
              />
            </Row>
          )}

          {/* Services */}
          {s.services && s.services.length > 0 && (
            <Row label={`Services (${s.services.length})`} approved={!!approve.services} onToggle={() => toggle('services')}>
              <ul className="text-xs text-slate-400 list-disc pl-4 space-y-0.5">
                {s.services.map((sv, i) => (
                  <li key={i}><span className="text-slate-300">{sv.title}</span> — {sv.description}</li>
                ))}
              </ul>
            </Row>
          )}

          {/* Socials */}
          {s.socials && s.socials.length > 0 && (
            <Row label={`Social links (${s.socials.length})`} approved={!!approve.socials} onToggle={() => toggle('socials')}>
              <ul className="text-xs text-slate-400 space-y-0.5">
                {s.socials.map((so, i) => (
                  <li key={i}><span className="text-slate-300">{so.platform}</span> · <span className="break-all">{so.href}</span></li>
                ))}
              </ul>
            </Row>
          )}

          {/* Images */}
          {s.logo && (
            <ImageRow label="Logo" url={s.logo.url} approved={!!approve.logo} onToggle={() => toggle('logo')} />
          )}
          {s.heroImage && (
            <ImageRow label="Hero image" url={s.heroImage.url} approved={!!approve.heroImage} onToggle={() => toggle('heroImage')} />
          )}
          {s.aboutImage && (
            <ImageRow label="About image" url={s.aboutImage.url} approved={!!approve.aboutImage} onToggle={() => toggle('aboutImage')} />
          )}

          {/* UGC gallery */}
          {s.ugc && s.ugc.length > 0 && (
            <Row label={`Social gallery (${s.ugc.length})`} approved={!!approve.ugc} onToggle={() => toggle('ugc')}>
              <div className="flex flex-wrap gap-2">
                {s.ugc.map((u, i) => (
                  u.asset?.url ? (
                    <img key={i} src={u.asset.url} alt={u.caption ?? u.platform} className="h-16 w-16 rounded object-cover border border-slate-700" />
                  ) : (
                    <span key={i} className="text-xs text-slate-500">{u.platform} (link only)</span>
                  )
                ))}
              </div>
            </Row>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={handleApply}
              disabled={applying}
              className="px-3 py-1.5 rounded border border-emerald-800 bg-emerald-950/40 text-emerald-200 text-xs hover:bg-emerald-900/40 disabled:opacity-50"
            >
              {applying ? 'Applying…' : 'Apply selected'}
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={applying}
              className="px-3 py-1.5 rounded border border-slate-700 bg-slate-900/60 text-slate-300 text-xs hover:bg-slate-800 disabled:opacity-50"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Row({
  label,
  approved,
  onToggle,
  children,
}: {
  label: string;
  approved: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 border-t border-slate-800 pt-3 first:border-t-0 first:pt-0">
      <label className="flex items-center gap-2 text-sm text-slate-200">
        <input type="checkbox" checked={approved} onChange={onToggle} className="accent-emerald-500" />
        <span className="font-medium">{label}</span>
      </label>
      {children}
    </div>
  );
}

function ImageRow({ label, url, approved, onToggle }: { label: string; url: string; approved: boolean; onToggle: () => void }) {
  return (
    <Row label={label} approved={approved} onToggle={onToggle}>
      <img src={url} alt={label} className="max-h-32 rounded border border-slate-700 object-cover" />
    </Row>
  );
}
