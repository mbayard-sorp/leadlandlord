'use client';

import { useState, useTransition } from 'react';
import { regenerateContent, regenerateHero } from './actions';

interface Props {
  siteId: string;
  hasHeroPrompt: boolean;
}

/**
 * "Regenerate" actions on the site detail page.
 *
 * - Hero: synchronous — calls Imagen + uploads to Sanity + patches site doc.
 *   ~5-15s. Result URL surfaces inline.
 * - Content: enqueues an agent_event row; the next operator-tick cron
 *   dispatches Site Builder. Operator watches /operator/agents for progress.
 */
export function RegenerateButtons({ siteId, hasHeroPrompt }: Props) {
  const [pendingHero, startHeroTransition] = useTransition();
  const [pendingContent, startContentTransition] = useTransition();
  const [heroMsg, setHeroMsg] = useState<string | null>(null);
  const [contentMsg, setContentMsg] = useState<string | null>(null);

  function regenHero() {
    setHeroMsg(null);
    startHeroTransition(async () => {
      const r = await regenerateHero(siteId);
      setHeroMsg(r.ok ? `New hero uploaded: ${r.heroImageUrl ?? '(no url)'}` : (r.message ?? 'regen failed'));
    });
  }

  function regenContent() {
    if (!confirm('Re-run the full content engine for this site? Costs ~$0.20-0.40 in Anthropic API.')) return;
    setContentMsg(null);
    startContentTransition(async () => {
      const r = await regenerateContent(siteId);
      setContentMsg(r.ok ? `Enqueued event ${r.eventId?.slice(0, 8)}… — next operator-tick cron dispatches.` : (r.message ?? 'enqueue failed'));
    });
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-3">
      <header>
        <h3 className="text-sm font-semibold text-slate-200">Regenerate</h3>
        <p className="text-xs text-slate-500 mt-1">
          Both actions overwrite Sanity in place — deterministic doc IDs make them safe to re-run.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={regenHero}
          disabled={pendingHero || !hasHeroPrompt}
          title={!hasHeroPrompt ? 'No heroImagePrompt on site doc — re-run content first' : 'Generate a fresh hero from the existing prompt'}
          className="px-3 py-2 rounded border border-slate-700 bg-slate-900/60 text-slate-200 text-sm hover:bg-slate-800 disabled:opacity-50"
        >
          {pendingHero ? 'Generating hero…' : 'Regenerate hero image'}
        </button>
        <button
          type="button"
          onClick={regenContent}
          disabled={pendingContent}
          className="px-3 py-2 rounded border border-slate-700 bg-slate-900/60 text-slate-200 text-sm hover:bg-slate-800 disabled:opacity-50"
        >
          {pendingContent ? 'Enqueueing…' : 'Regenerate full content'}
        </button>
      </div>

      {heroMsg && (
        <p className={`text-xs ${heroMsg.includes('failed') || heroMsg.includes('not configured') ? 'text-red-300' : 'text-emerald-300'} break-all`}>
          {heroMsg}
        </p>
      )}
      {contentMsg && (
        <p className={`text-xs ${contentMsg.includes('failed') ? 'text-red-300' : 'text-emerald-300'}`}>
          {contentMsg}
        </p>
      )}
    </div>
  );
}
