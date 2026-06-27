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
  topLevelFields: ClientFieldDef[];
  /** Initial CDN thumbnail URLs keyed by fieldKey, derived server-side from the doc. */
  initialThumbnails: Record<string, string | undefined>;
  /** Whether structural edits are locked (site handed off). */
  isStructurallyLocked: boolean;
}

export default function EditorShell({
  siteId,
  sanityDocId,
  initialValues,
  sections: initialSections,
  topLevelFields,
  initialThumbnails,
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
  // EditorForm exposes isSaving via the handle so we can check it too.
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

        {/* Tab panels — both mounted, only one visible, so form state is preserved */}
        <div className={`flex-1 overflow-hidden ${activeTab === 'content' ? 'flex flex-col' : 'hidden'}`}>
          <EditorForm
            ref={editorFormRef}
            siteId={siteId}
            initialValues={initialValues}
            sections={sections}
            topLevelFields={topLevelFields}
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
            onUploadSuccess={handleSaveSuccess}
          />
        </div>
      </div>

      {/* Right: preview (hidden on mobile) */}
      <div className="hidden md:flex flex-col flex-1 overflow-hidden">
        <LivePreview sanityDocId={sanityDocId} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
