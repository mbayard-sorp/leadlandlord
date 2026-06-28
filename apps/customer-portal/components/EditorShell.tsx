'use client';

/**
 * EditorShell — client component that owns the two-pane editor layout.
 *
 * Cross-cutting state:
 *   - `refreshKey`     — bumped after save/structural op to reload the preview iframe.
 *   - `sections`       — optimistic ordered section list (used for drag-drop preview).
 *   - `structuralPending` — true while any structural op is in flight.
 *   - `structuralError`   — last structural op error message.
 *
 * D4 flush-then-structural sequencing:
 *   EditorForm exposes an imperative `flushSave()` via ref. Before any
 *   structural action EditorShell calls `flushSave()` and awaits success,
 *   then runs the structural action, then router.refresh() + bumps refreshKey.
 *
 * The save/publish/discard/uploadImage server actions are imported here
 * (they are server references, serialisable across the RSC boundary).
 *
 * The left pane has two tabs: "Content" (text fields) and "Photos & Logo"
 * (image uploads). Switching tabs does not reset form state.
 */

import { useState, useCallback, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import EditorForm, { type EditorFormHandle } from './EditorForm';
import MediaPanel from './MediaPanel';
import LivePreview from './LivePreview';
import type { ClientSectionDef, ClientFieldDef } from '@/lib/fields';
import {
  saveAction,
  publishAction,
  discardAction,
  uploadImageAction,
  generateImageAction,
  reorderSectionsAction,
  addSectionAction,
  removeSectionAction,
  duplicateSectionAction,
} from '@/app/sites/[id]/edit/actions';
import { BS_SECTION_RULES } from '@leadlandlord/shared';

// ---------------------------------------------------------------------------
// Tab type
// ---------------------------------------------------------------------------

type EditorTab = 'content' | 'media';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EditorShellProps {
  siteId: string;
  sanityDocId: string;
  initialValues: Record<string, string>;
  sections: ClientSectionDef[];
  /** Phone + nav-CTA fields — rendered as "Your menu button & phone" group. */
  businessFields: ClientFieldDef[];
  /** SEO fields — rendered collapsed at the bottom of the content tab. */
  seoFields: ClientFieldDef[];
  /** Initial CDN thumbnail URLs keyed by fieldKey, derived server-side from the doc. */
  initialThumbnails: Record<string, string | undefined>;
  /**
   * Absolute preview URL on the site-host ORIGIN (e.g. https://sites.example.com
   * /preview/<uuid>). Must be absolute so the iframe's relative /_next asset
   * requests resolve against site-host, not the portal — otherwise the preview
   * renders unstyled. Built server-side from SITE_HOST_ORIGIN in page.tsx.
   */
  previewUrl: string;
  /** AI image generations already used by this site (from the published doc). */
  generationsUsed: number;
  /** Hard cap on AI image generations per site. */
  generationLimit: number;
  /** Whether structural edits are locked (site handed off). */
  isStructurallyLocked: boolean;
}

export default function EditorShell({
  siteId,
  sanityDocId,
  initialValues,
  sections: initialSections,
  businessFields,
  seoFields,
  initialThumbnails,
  previewUrl,
  generationsUsed,
  generationLimit,
  isStructurallyLocked,
}: EditorShellProps) {
  const router = useRouter();

  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<EditorTab>('content');

  // Optimistic section order for drag-drop. Reset when router.refresh() fires
  // (page re-renders with fresh server state).
  const [sections, setSections] = useState<ClientSectionDef[]>(initialSections);

  // Error from structural ops (shown inline near the section list).
  const [structuralError, setStructuralError] = useState<string | null>(null);

  // One transition for structural ops — gives us `structuralPending`.
  const [structuralPending, startStructural] = useTransition();

  // Ref to EditorForm's imperative flush handle (D4).
  const editorFormRef = useRef<EditorFormHandle>(null);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const bumpPreview = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleSaveSuccess = useCallback(() => {
    bumpPreview();
  }, [bumpPreview]);

  /**
   * D4 flush: if there are pending text edits in the form, programmatically
   * submit the form and await success. Short-circuits if nothing is dirty.
   * Throws on failure so the caller can abort the structural op.
   */
  const flushTextEdits = useCallback(async (): Promise<void> => {
    const handle = editorFormRef.current;
    if (!handle) return;
    await handle.flushSave();
  }, []);

  /**
   * Run a structural op with the D4 flush-then-structural sequence:
   *   1. Flush pending text edits (await save).
   *   2. Run the structural server action.
   *   3. router.refresh() to re-derive section list from server.
   *   4. Bump preview refreshKey.
   */
  const runStructural = useCallback(
    async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
      setStructuralError(null);
      try {
        await flushTextEdits();
      } catch {
        setStructuralError('Could not save text edits before the structural change. Please try again.');
        return;
      }
      startStructural(async () => {
        const result = await fn();
        if (!result.ok) {
          setStructuralError(result.message ?? 'Operation failed.');
          return;
        }
        router.refresh();
        bumpPreview();
      });
    },
    [flushTextEdits, bumpPreview, router],
  );

  // ---------------------------------------------------------------------------
  // Structural handlers
  // ---------------------------------------------------------------------------

  const handleReorder = useCallback(
    (newOrder: ClientSectionDef[]) => {
      // Optimistic update immediately.
      setSections(newOrder);
      runStructural(() =>
        reorderSectionsAction(
          siteId,
          newOrder.map((s) => s.sectionKey),
        ),
      );
    },
    [runStructural, siteId],
  );

  const handleAdd = useCallback(
    (sectionType: string) => {
      runStructural(() => addSectionAction(siteId, sectionType));
    },
    [runStructural, siteId],
  );

  const handleRemove = useCallback(
    (sectionKey: string) => {
      runStructural(() => removeSectionAction(siteId, sectionKey));
    },
    [runStructural, siteId],
  );

  const handleDuplicate = useCallback(
    (sectionKey: string) => {
      runStructural(() => duplicateSectionAction(siteId, sectionKey));
    },
    [runStructural, siteId],
  );

  // Any op pending = disable structural controls.
  const anyPending = structuralPending;

  // ---------------------------------------------------------------------------
  // Addable types for the picker (excludes singletons already present).
  // ---------------------------------------------------------------------------
  const presentSingletons = new Set(
    sections
      .filter((s) => BS_SECTION_RULES[s.sectionType as keyof typeof BS_SECTION_RULES]?.singleton)
      .map((s) => s.sectionType),
  );
  const addableTypes = (Object.keys(BS_SECTION_RULES) as Array<keyof typeof BS_SECTION_RULES>).filter(
    (type) => {
      const rule = BS_SECTION_RULES[type];
      return rule.addable && !(rule.singleton && presentSingletons.has(type));
    },
  );

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: form (content + media tabs) */}
      <div
        className="w-full md:w-[42%] overflow-hidden flex flex-col border-r"
        style={{ borderColor: 'var(--color-border)' }}
      >
        {/* Tab bar */}
        <div
          className="flex shrink-0 border-b"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel)' }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('content')}
            className="flex-1 px-4 py-2.5 text-xs font-medium transition-colors"
            style={{
              color: activeTab === 'content' ? 'var(--color-fg)' : 'var(--color-muted)',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'content' ? '2px solid var(--color-accent)' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            Content
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('media')}
            className="flex-1 px-4 py-2.5 text-xs font-medium transition-colors"
            style={{
              color: activeTab === 'media' ? 'var(--color-fg)' : 'var(--color-muted)',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'media' ? '2px solid var(--color-accent)' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            Photos &amp; Logo
          </button>
        </div>

        {/* Mobile: "Open preview in new tab" button */}
        <div
          className="md:hidden px-4 py-2 border-b"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
        >
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium"
            style={{ color: 'var(--color-accent)' }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Open preview in new tab
          </a>
        </div>

        {/* Tab panels — both mounted, only one visible, so form state is preserved */}
        <div className={`flex-1 overflow-hidden ${activeTab === 'content' ? 'flex flex-col' : 'hidden'}`}>
          <EditorForm
            ref={editorFormRef}
            siteId={siteId}
            initialValues={initialValues}
            sections={sections}
            businessFields={businessFields}
            seoFields={seoFields}
            saveAction={saveAction}
            publishAction={publishAction}
            discardAction={discardAction}
            onSaveSuccess={handleSaveSuccess}
            onReorder={handleReorder}
            onAdd={handleAdd}
            onRemove={handleRemove}
            onDuplicate={handleDuplicate}
            isStructurallyLocked={isStructurallyLocked}
            addableTypes={addableTypes}
            structuralPending={anyPending}
            structuralError={structuralError}
          />
        </div>

        <div className={`flex-1 overflow-hidden ${activeTab === 'media' ? 'flex flex-col' : 'hidden'}`}>
          <MediaPanel
            siteId={siteId}
            initialThumbnails={initialThumbnails}
            uploadImageAction={uploadImageAction}
            generateImageAction={generateImageAction}
            generationsUsed={generationsUsed}
            generationLimit={generationLimit}
            onUploadSuccess={handleSaveSuccess}
          />
        </div>
      </div>

      {/* Right: preview (hidden on mobile) */}
      <div className="hidden md:flex flex-col flex-1 overflow-hidden">
        <LivePreview
          sanityDocId={sanityDocId}
          refreshKey={refreshKey}
          previewUrl={previewUrl}
        />
      </div>
    </div>
  );
}
