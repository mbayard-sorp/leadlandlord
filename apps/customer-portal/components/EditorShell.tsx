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
import { saveAction, publishAction, discardAction, uploadImageAction, generateImageAction } from '@/app/sites/[id]/edit/actions';

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
}

export default function EditorShell({
  siteId,
  sanityDocId,
  initialValues,
  sections,
  businessFields,
  seoFields,
  initialThumbnails,
  previewUrl,
  generationsUsed,
  generationLimit,
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
            siteId={siteId}
            initialValues={initialValues}
            sections={sections}
            businessFields={businessFields}
            seoFields={seoFields}
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
