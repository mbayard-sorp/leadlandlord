'use client';

import { useState, useTransition } from 'react';
import {
  saveBuildSellImagePrompt,
  regenerateBuildSellImage,
  type BuildSellImageKind,
} from './actions';

interface KindConfig {
  kind: BuildSellImageKind;
  label: string;
  aspect: string;
  promptField: string;
}

const KINDS: KindConfig[] = [
  { kind: 'hero',  label: 'Hero',  aspect: '16:9', promptField: 'heroImagePrompt'  },
  { kind: 'about', label: 'About', aspect: '4:3',  promptField: 'aboutImagePrompt' },
  { kind: 'og',    label: 'OG',    aspect: '1:1',  promptField: 'ogImagePrompt'    },
];

interface Props {
  siteId: string;
  /**
   * Prompts can be pre-populated server-side by fetching the Sanity doc.
   * The panel works without them (empty textarea = disabled regen button).
   */
  initialPrompts?: Partial<Record<BuildSellImageKind, string>>;
}

interface KindState {
  prompt: string;
  saveMsg: string | null;
  regenMsg: string | null;
  regenUrl: string | null;
}

function buildInitialState(
  kind: BuildSellImageKind,
  initial: Partial<Record<BuildSellImageKind, string>> | undefined,
): KindState {
  return {
    prompt:   initial?.[kind] ?? '',
    saveMsg:  null,
    regenMsg: null,
    regenUrl: null,
  };
}

/**
 * Per-site image-prompt control panel.
 *
 * Operator can edit the Imagen prompt for each image kind (hero / about / og),
 * save it to the Sanity doc, and regenerate the image on demand.
 *
 * Regenerate is disabled when the prompt textarea is empty (R15 — spend $0
 * when there is nothing to generate from). The server action enforces a
 * durable per-site daily cap (BUILDSELL_REGEN_CAP_PER_DAY, default 5).
 *
 * Rebuild-clobber note: any prompt edits saved here are preserved on a
 * future rebuild via the read-merge policy in persist-sanity.ts (Phase 2).
 * Operator-edited prompts are one of the "operator-owned fields" that the
 * builder reads from the existing Sanity doc before overwriting.
 */
export function BuildSellImagePanel({ siteId, initialPrompts }: Props) {
  const [states, setStates] = useState<Record<BuildSellImageKind, KindState>>({
    hero:  buildInitialState('hero',  initialPrompts),
    about: buildInitialState('about', initialPrompts),
    og:    buildInitialState('og',    initialPrompts),
  });

  function updateState(kind: BuildSellImageKind, patch: Partial<KindState>) {
    setStates((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
  }

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
          Image prompts
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Edit the Imagen prompt for each image slot, then save or regenerate. Saved prompts are
          preserved on site rebuild (read-merge). Regenerate is rate-limited per site per day
          (BUILDSELL_REGEN_CAP_PER_DAY, default 5).
        </p>
      </header>

      {KINDS.map((cfg) => (
        <KindRow
          key={cfg.kind}
          siteId={siteId}
          config={cfg}
          state={states[cfg.kind]}
          onUpdate={(patch) => updateState(cfg.kind, patch)}
        />
      ))}
    </section>
  );
}

interface KindRowProps {
  siteId: string;
  config: KindConfig;
  state: KindState;
  onUpdate: (patch: Partial<KindState>) => void;
}

function KindRow({ siteId, config, state, onUpdate }: KindRowProps) {
  const [pendingSave, startSave] = useTransition();
  const [pendingRegen, startRegen] = useTransition();
  const promptEmpty = state.prompt.trim() === '';

  function handleSave() {
    onUpdate({ saveMsg: null });
    startSave(async () => {
      const r = await saveBuildSellImagePrompt(siteId, config.kind, state.prompt);
      onUpdate({ saveMsg: r.ok ? 'Prompt saved.' : (r.message ?? 'save failed') });
    });
  }

  function handleRegen() {
    onUpdate({ regenMsg: null, regenUrl: null });
    startRegen(async () => {
      const r = await regenerateBuildSellImage(siteId, config.kind);
      if (r.ok) {
        onUpdate({ regenMsg: `Regenerated.`, regenUrl: r.imageUrl ?? null });
      } else {
        onUpdate({ regenMsg: r.message ?? 'regen failed' });
      }
    });
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-slate-200">{config.label}</h3>
        <span className="text-xs text-slate-600 font-mono">{config.aspect}</span>
      </div>

      {/* Prompt textarea */}
      <textarea
        className="w-full rounded border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 resize-y focus:outline-none focus:ring-1 focus:ring-sky-700"
        rows={3}
        placeholder={`${config.label} image prompt (Imagen)…`}
        value={state.prompt}
        onChange={(e) => onUpdate({ prompt: e.target.value, saveMsg: null })}
      />

      {/* Thumbnail (shown after regen or if an image already exists) */}
      {state.regenUrl && (
        <img
          src={state.regenUrl}
          alt={`${config.label} regenerated image`}
          className="rounded border border-slate-700 max-h-40 object-cover"
        />
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={pendingSave || promptEmpty}
          className="px-3 py-1.5 rounded border border-slate-700 bg-slate-900/60 text-slate-200 text-xs hover:bg-slate-800 disabled:opacity-50"
        >
          {pendingSave ? 'Saving…' : 'Save prompt'}
        </button>
        <button
          type="button"
          onClick={handleRegen}
          disabled={pendingRegen || promptEmpty}
          title={promptEmpty ? 'Save a prompt first before regenerating' : `Regenerate ${config.label} image (${config.aspect}) from prompt`}
          className="px-3 py-1.5 rounded border border-slate-700 bg-slate-900/60 text-slate-200 text-xs hover:bg-slate-800 disabled:opacity-50"
        >
          {pendingRegen ? 'Generating…' : 'Regenerate image'}
        </button>
      </div>

      {/* Feedback messages */}
      {state.saveMsg && (
        <p className={`text-xs ${state.saveMsg.includes('failed') || state.saveMsg.includes('Failed') ? 'text-red-300' : 'text-emerald-300'}`}>
          {state.saveMsg}
        </p>
      )}
      {state.regenMsg && (
        <p className={`text-xs ${state.regenMsg.includes('failed') || state.regenMsg.includes('cap') ? 'text-red-300' : 'text-emerald-300'} break-all`}>
          {state.regenMsg}
        </p>
      )}
    </div>
  );
}
