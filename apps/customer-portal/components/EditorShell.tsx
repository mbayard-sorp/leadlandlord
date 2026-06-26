'use client';

/**
 * EditorShell — client component that owns the two-pane editor layout.
 *
 * It manages the `refreshKey` state so that after each successful save or
 * image upload the live preview iframe reloads. All server-fetched data
 * arrives as serialisable props (no function props from the server).
 *
 * The save/publish/discard/uploadImage server actions are imported here
 * (they are server references, serialisable across the RSC boundary).
 *
 * The left pane has two tabs: "Content" (text fields) and "Photos & Logo"
 * (image uploads). Switching tabs does not reset form state.
 */

import { useState, useCallback } from 'react';
import EditorForm from './EditorForm';
import MediaPanel from './MediaPanel';
import LivePreview from './LivePreview';
import type { ClientSectionDef, ClientFieldDef } from '@/lib/fields';
import { saveAction, publishAction, discardAction, uploadImageAction } from '@/app/sites/[id]/edit/actions';

// ---------------------------------------------------------------------------
// Tab type
// ---------------------------------------------------------------------------

type EditorTab = 'content' | 'media';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EditorShellProps {
  siteId: string;
  /** site-host origin the preview iframe loads from (so its /_next assets resolve). */
  siteHostOrigin: string;
  initialValues: Record<string, string>;
  sections: ClientSectionDef[];
  topLevelFields: ClientFieldDef[];
  /** Initial CDN thumbnail URLs keyed by fieldKey, derived server-side from the doc. */
  initialThumbnails: Record<string, string | undefined>;
}

export default function EditorShell({
  siteId,
  siteHostOrigin,
  initialValues,
  sections,
  topLevelFields,
  initialThumbnails,
}: EditorShellProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<EditorTab>('content');

  const handleSaveSuccess = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

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
            siteId={siteId}
            initialValues={initialValues}
            sections={sections}
            topLevelFields={topLevelFields}
            saveAction={saveAction}
            publishAction={publishAction}
            discardAction={discardAction}
            onSaveSuccess={handleSaveSuccess}
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
        <LivePreview previewId={siteId} previewOrigin={siteHostOrigin} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
