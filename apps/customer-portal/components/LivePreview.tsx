'use client';

/**
 * LivePreview — iframe wrapper for the site-host draft preview.
 *
 * How draft mode is activated:
 *   1. The initial src is `/api/draft-mode/enable?redirect=/preview/<sanityDocId>`.
 *   2. This request is rewritten (via next.config.ts) to the site-host origin,
 *      which sets a draft-mode cookie and redirects to `/preview/<sanityDocId>`.
 *   3. The preview route mounts `SanityLive` + `VisualEditing` which stream
 *      updates from the Sanity CDN. After a successful save the parent
 *      increments `refreshKey` to reload the iframe as a fallback.
 *
 * Both the portal domain and the proxied preview are same-origin (rewrite),
 * so cookies and `SanityLive` EventSource connections work without CORS.
 */

import { useEffect, useRef, useState } from 'react';

interface LivePreviewProps {
  /** The Sanity doc ID for this site (bs-site-<uuid>). */
  sanityDocId: string;
  /** Increment to force an iframe reload (e.g. after a successful save). */
  refreshKey?: number;
}

export default function LivePreview({ sanityDocId, refreshKey = 0 }: LivePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  // The first load goes through the draft-mode enable endpoint so the
  // site-host preview route gets the draft-mode cookie.
  const enableUrl = `/api/draft-mode/enable?redirect=/preview/${sanityDocId}`;

  // When refreshKey changes (after a save), reload the iframe.
  // We use the src setter rather than location.reload() because the iframe
  // may have navigated to a different URL after the redirect.
  useEffect(() => {
    if (refreshKey === 0) return; // Don't reload on mount.
    const iframe = iframeRef.current;
    if (!iframe) return;
    // Re-navigate through the enable endpoint so draft mode stays active.
    iframe.src = enableUrl;
    setReady(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  function handleManualRefresh() {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.src = enableUrl;
    setReady(false);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b text-xs"
        style={{
          background: 'var(--color-panel)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-muted)',
        }}
      >
        <span>Live preview (draft)</span>
        <button
          type="button"
          onClick={handleManualRefresh}
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
          style={{ color: 'var(--color-accent)' }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
          Refresh preview
        </button>
      </div>

      {/* Loading overlay */}
      {!ready && (
        <div
          className="absolute inset-0 flex items-center justify-center text-xs pointer-events-none"
          style={{ color: 'var(--color-muted)', zIndex: 1 }}
        >
          Loading preview...
        </div>
      )}

      {/* iframe */}
      <div className="relative flex-1 overflow-hidden">
        <iframe
          ref={iframeRef}
          src={enableUrl}
          title="Site preview"
          className="w-full h-full border-0"
          onLoad={() => setReady(true)}
          style={{ minHeight: '600px' }}
        />
      </div>
    </div>
  );
}
