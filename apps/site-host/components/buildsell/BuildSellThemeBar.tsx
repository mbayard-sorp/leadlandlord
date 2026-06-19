'use client';

/**
 * BuildSellThemeBar
 *
 * Floating theme-picker bar rendered only inside /preview/[id] (draft===true).
 * All changes are instant CSS-var mutations on the .bs-root element -- no
 * server round-trips and no React re-renders until Save is clicked.
 *
 * Font choices are limited to the keys of BUILDSELL_FONT_VAR_MAP. Every font
 * in that map has a corresponding next/font instance in buildsell-fonts.ts that
 * is already loaded by the preview page wrapper (ALL_BS_FONTS.map(f=>f.variable)
 * applied as className on the root div). CSS vars --font-bs-* are therefore
 * in the document when this component mounts -- swapping fonts is instant.
 *
 * Server-safe secrets (BS_SANITY_WRITE_TOKEN, BS_PREVIEW_HMAC_SECRET) never
 * reach this component. saveToken is the per-site HMAC digest passed server
 * -> client as a plain prop from the preview page.
 */

import { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BUILDSELL_PRESETS } from '@leadlandlord/sanity-schema/presets';
import { BUILDSELL_FONT_VAR_MAP } from '@/lib/buildsell-fonts';
import { presetByName } from '@leadlandlord/sanity-schema/presets';
import type { BuildSellTheme } from '@/lib/sanity';

// Layout variants available to buyers.
const LAYOUT_VARIANTS = ['split', 'bold', 'trust'] as const;
type LayoutVariant = (typeof LAYOUT_VARIANTS)[number];

// All font names that are pre-loaded and available as CSS vars.
const FONT_NAMES = Object.keys(BUILDSELL_FONT_VAR_MAP);

interface BuildSellThemeBarProps {
  siteId: string;
  initialTheme: BuildSellTheme;
  saveToken: string | null;
  themeLocked: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function BuildSellThemeBar({
  siteId,
  initialTheme,
  saveToken,
  themeLocked: initialLocked,
}: BuildSellThemeBarProps) {
  const [preset, setPreset] = useState<string>(
    initialTheme.preset ?? BUILDSELL_PRESETS[0]?.name ?? 'Aqua Slate',
  );
  const [layout, setLayout] = useState<LayoutVariant>(
    (initialTheme.layoutVariant ?? 'split') as LayoutVariant,
  );
  const [fontHeading, setFontHeading] = useState<string>(
    initialTheme.fontHeading ?? FONT_NAMES[0] ?? 'Space Grotesk',
  );
  const [fontBody, setFontBody] = useState<string>(
    initialTheme.fontBody ?? FONT_NAMES[0] ?? 'Inter',
  );
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [locked, setLocked] = useState(initialLocked);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Ref to the .bs-root element so we can mutate CSS vars without a re-render.
  const getRootEl = useCallback((): HTMLElement | null => {
    return document.querySelector('.bs-root');
  }, []);

  // Apply color vars from a preset to the .bs-root element.
  const applyPresetColors = useCallback(
    (presetName: string) => {
      const p = presetByName(presetName);
      if (!p) return;
      const el = getRootEl();
      if (!el) return;
      el.style.setProperty('--bs-primary', p.primary);
      el.style.setProperty('--bs-primary-dark', p.primaryDark);
      el.style.setProperty('--bs-accent', p.accent);
      el.style.setProperty('--bs-on-primary', p.onPrimary);
      el.style.setProperty('--bs-bg', p.bg);
      el.style.setProperty('--bs-surface', p.surface);
      el.style.setProperty('--bs-text', p.text);
      el.style.setProperty('--bs-muted', p.muted);
    },
    [getRootEl],
  );

  // Apply font vars to .bs-root element.
  const applyFont = useCallback(
    (slot: 'heading' | 'body', fontName: string) => {
      const el = getRootEl();
      if (!el) return;
      const cssVar = BUILDSELL_FONT_VAR_MAP[fontName];
      if (!cssVar) return;
      el.style.setProperty(
        slot === 'heading' ? '--bs-font-heading' : '--bs-font-body',
        cssVar,
      );
    },
    [getRootEl],
  );

  const handlePresetChange = (name: string) => {
    setPreset(name);
    applyPresetColors(name);
  };

  const handleLayoutChange = (v: LayoutVariant) => {
    setLayout(v);
    // Instant CSS-level feedback (nav treatment, grid alignment) while the
    // server round-trip below swaps the per-variant block structure.
    const el = getRootEl();
    if (el) el.setAttribute('data-bs-layout', v);

    // The hero/contact/etc. structure is server-rendered from the layoutVariant
    // prop, so a client attribute flip alone can't change it. Push the selection
    // (plus the in-progress preset/fonts and the save token) to the URL and let
    // the force-dynamic preview route re-render with the new variant.
    const params = new URLSearchParams();
    const token = searchParams.get('t');
    if (token) params.set('t', token);
    params.set('layout', v);
    params.set('preset', preset);
    params.set('fh', fontHeading);
    params.set('fb', fontBody);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleFontHeadingChange = (name: string) => {
    setFontHeading(name);
    applyFont('heading', name);
  };

  const handleFontBodyChange = (name: string) => {
    setFontBody(name);
    applyFont('body', name);
  };

  const handleSave = async () => {
    if (!saveToken || locked) return;
    setSaveState('saving');
    setErrorMsg('');
    try {
      const res = await fetch(`/api/bs-theme/${siteId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${saveToken}`,
        },
        body: JSON.stringify({ preset, layoutVariant: layout, fontHeading, fontBody }),
      });

      if (res.ok) {
        setSaveState('saved');
        setLocked(true);
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      const msg = data.error ?? `Error ${res.status}`;

      if (res.status === 409) {
        setErrorMsg('Theme already locked by buyer.');
        setLocked(true);
      } else if (res.status === 401) {
        setErrorMsg('Not authorized to save.');
      } else if (res.status === 403) {
        setErrorMsg('Cannot save on a live site.');
      } else {
        setErrorMsg(msg);
      }
      setSaveState('error');
    } catch {
      setErrorMsg('Network error. Please try again.');
      setSaveState('error');
    }
  };

  const canSave = !!saveToken && !locked;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '80px', // above mobile call bar if present
        right: '16px',
        zIndex: 9999,
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
        padding: '16px',
        width: '260px',
        fontSize: '13px',
        fontFamily: 'system-ui, sans-serif',
        color: '#1a1a1a',
      }}
      aria-label="Theme customization"
    >
      <div style={{ fontWeight: 700, marginBottom: '12px', fontSize: '14px' }}>
        Customize Theme
      </div>

      {/* Preset picker */}
      <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>
        Color Preset
      </label>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          marginBottom: '12px',
        }}
      >
        {BUILDSELL_PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => handlePresetChange(p.name)}
            title={p.name}
            aria-pressed={preset === p.name}
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              background: p.primary,
              border:
                preset === p.name
                  ? `3px solid #1a1a1a`
                  : '2px solid transparent',
              cursor: 'pointer',
              padding: 0,
              outline: 'none',
              flexShrink: 0,
            }}
          />
        ))}
      </div>
      {/* Selected preset label */}
      <div style={{ marginBottom: '12px', color: '#64748b', fontSize: '12px' }}>
        {preset}
      </div>

      {/* Layout variant */}
      <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>
        Layout
      </label>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
        {LAYOUT_VARIANTS.map((v) => (
          <button
            key={v}
            onClick={() => handleLayoutChange(v)}
            aria-pressed={layout === v}
            style={{
              flex: 1,
              padding: '4px 0',
              borderRadius: '6px',
              border: layout === v ? '2px solid #4f46e5' : '1px solid #e2e8f0',
              background: layout === v ? '#ede9fe' : '#f8fafc',
              fontWeight: layout === v ? 700 : 400,
              cursor: 'pointer',
              fontSize: '12px',
              textTransform: 'capitalize',
            }}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Font heading */}
      <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>
        Heading Font
      </label>
      <select
        value={fontHeading}
        onChange={(e) => handleFontHeadingChange(e.target.value)}
        style={{
          width: '100%',
          marginBottom: '10px',
          padding: '5px',
          borderRadius: '6px',
          border: '1px solid #e2e8f0',
          fontSize: '13px',
        }}
      >
        {FONT_NAMES.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>

      {/* Font body */}
      <label style={{ display: 'block', marginBottom: '4px', fontWeight: 600 }}>
        Body Font
      </label>
      <select
        value={fontBody}
        onChange={(e) => handleFontBodyChange(e.target.value)}
        style={{
          width: '100%',
          marginBottom: '14px',
          padding: '5px',
          borderRadius: '6px',
          border: '1px solid #e2e8f0',
          fontSize: '13px',
        }}
      >
        {FONT_NAMES.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>

      {/* Save button */}
      {canSave ? (
        <button
          onClick={handleSave}
          disabled={saveState === 'saving'}
          style={{
            width: '100%',
            padding: '8px',
            borderRadius: '8px',
            border: 'none',
            background: saveState === 'saving' ? '#94a3b8' : '#4f46e5',
            color: '#fff',
            fontWeight: 700,
            fontSize: '14px',
            cursor: saveState === 'saving' ? 'not-allowed' : 'pointer',
          }}
        >
          {saveState === 'saving' ? 'Saving...' : 'Save Theme'}
        </button>
      ) : (
        <div
          style={{
            width: '100%',
            padding: '8px',
            borderRadius: '8px',
            background: '#f1f5f9',
            color: '#64748b',
            fontWeight: 700,
            fontSize: '14px',
            textAlign: 'center',
          }}
        >
          {locked ? (saveState === 'saved' ? 'Theme Saved' : 'Theme Locked') : 'Preview Only'}
        </div>
      )}

      {saveState === 'saved' && (
        <div style={{ marginTop: '8px', color: '#15803d', fontSize: '12px', fontWeight: 600 }}>
          Theme saved successfully.
        </div>
      )}
      {saveState === 'error' && errorMsg && (
        <div style={{ marginTop: '8px', color: '#be123c', fontSize: '12px', fontWeight: 600 }}>
          {errorMsg}
        </div>
      )}
    </div>
  );
}
