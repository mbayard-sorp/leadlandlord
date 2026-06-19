'use client';

import { useState, useTransition } from 'react';
import { regenerateBuildSellSite } from './actions';

interface Props {
  siteId: string;
}

type Step = 'idle' | 'confirm';

/**
 * Full-site regenerate panel. Requires a two-step confirmation before firing
 * because the action replaces ALL AI copy and may rotate the theme.
 *
 * Hidden on paid/live sites (gated by the parent page). The server action
 * enforces a per-site daily cap (BUILDSELL_REBUILD_CAP_PER_DAY, default 3).
 */
export function BuildSellRegeneratePanel({ siteId }: Props) {
  const [step, setStep] = useState<Step>('idle');
  const [rotateTheme, setRotateTheme] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function handleInitiate() {
    setMsg(null);
    setStep('confirm');
  }

  function handleCancel() {
    setStep('idle');
    setMsg(null);
  }

  function handleConfirm() {
    setMsg(null);
    startTransition(async () => {
      const r = await regenerateBuildSellSite(siteId, { rotateTheme });
      if (r.ok) {
        setMsg({
          kind: 'ok',
          text: 'Queued — content regenerates in ~5-7 min; refresh the preview shortly.',
        });
        setStep('idle');
      } else {
        setMsg({ kind: 'err', text: r.message ?? 'regeneration failed' });
        setStep('idle');
      }
    });
  }

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Regenerate all content
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Replace ALL AI-generated copy for this site. Optionally re-roll the theme
          (preset, layout, fonts). Rate-limited per site per day
          (BUILDSELL_REBUILD_CAP_PER_DAY, default 3).
        </p>
      </header>

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        {step === 'idle' && (
          <button
            type="button"
            onClick={handleInitiate}
            disabled={pending}
            className="px-3 py-1.5 rounded border border-slate-700 bg-slate-900/60 text-slate-200 text-xs hover:bg-slate-800 disabled:opacity-50"
          >
            Regenerate all content
          </button>
        )}

        {step === 'confirm' && (
          <div className="space-y-3">
            <div className="rounded border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300 space-y-1">
              <p className="font-semibold">This replaces ALL AI-generated copy.</p>
              <p className="text-amber-400/80">
                Every section (hero, services, about, process, reviews, contact, footer)
                will be rewritten by the model. If you select &ldquo;Regenerate copy + new
                theme&rdquo; the preset, layout variant, and fonts will also be re-rolled.
                This cannot be undone.
              </p>
            </div>

            {/* Theme rotation choice */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-slate-400">Choose what to regenerate:</p>
              <label className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="radio"
                  name="rotateTheme"
                  value="rotate"
                  checked={rotateTheme}
                  onChange={() => setRotateTheme(true)}
                  disabled={pending}
                  className="mt-0.5 accent-sky-500"
                />
                <span className="text-xs text-slate-300 group-hover:text-slate-200">
                  <span className="font-medium">Regenerate copy + new theme</span>
                  <span className="text-slate-500"> — re-rolls preset, layout, and fonts</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer group">
                <input
                  type="radio"
                  name="rotateTheme"
                  value="keep"
                  checked={!rotateTheme}
                  onChange={() => setRotateTheme(false)}
                  disabled={pending}
                  className="mt-0.5 accent-sky-500"
                />
                <span className="text-xs text-slate-300 group-hover:text-slate-200">
                  <span className="font-medium">Regenerate copy, keep theme</span>
                  <span className="text-slate-500"> — colors, layout, and fonts are unchanged</span>
                </span>
              </label>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={pending}
                className="px-3 py-1.5 rounded border border-red-800 bg-red-950/40 text-red-300 text-xs hover:bg-red-900/40 disabled:opacity-50"
              >
                {pending ? 'Queuing…' : 'Yes, regenerate'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={pending}
                className="px-3 py-1.5 rounded border border-slate-700 bg-slate-900/60 text-slate-400 text-xs hover:bg-slate-800 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {msg && (
          <p className={`text-xs ${msg.kind === 'err' ? 'text-red-300' : 'text-emerald-300'}`}>
            {msg.text}
          </p>
        )}
      </div>
    </section>
  );
}
