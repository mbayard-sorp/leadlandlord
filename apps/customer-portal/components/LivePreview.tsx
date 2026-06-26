'use client';

/**
 * LivePreview — iframe wrapper for the site-host draft preview.
 *
 * The iframe loads `<site-host origin>/preview/<siteId>` directly (cross-origin),
 * NOT a same-origin proxy path. That matters: the preview HTML references its
 * CSS/JS at `/_next/static/*`, which only site-host serves — proxying just the
 * HTML through the portal origin leaves those assets 404ing and the page
 * unstyled. Loading from site-host's own origin resolves assets correctly, and
 * the in-iframe theme panel's API calls stay same-origin too. The preview route
 * resolves the site by UUID/slug and renders draft-preferred content
 * unconditionally — no Next.js draft mode or `sanity-preview-secret` handshake.
 *
 * After a successful save the parent increments `refreshKey`; we append it as a
 * cache-busting query param to force the iframe to reload the latest draft.
 */

import { useRef, useState } from 'react';

interface LivePreviewProps {
  /** The site identifier the preview route resolves — Postgres UUID or slug. */
  previewId: string;
  /** site-host origin (absolute) the preview is served from. */
  previewOrigin: string;
  /** Increment to force an iframe reload (e.g. after a successful save). */
  refreshKey?: number;
}

export default function LivePreview({ previewId, previewOrigin, refreshKey = 0 }: LivePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  // refreshKey rides along as a cache-buster so a re-render after save loads
  // fresh draft content. The preview route ignores unknown query params.
  const base = `${previewOrigin}/preview/${previewId}`;
  const previewUrl = `${base}${refreshKey ? `?r=${refreshKey}` : ''}`;

  function handleManualRefresh() {
    const iframe = iframeRef.current;
    if (!iframe) return;
    // Force a reload even when the URL is unchanged.
    iframe.src = `${base}?r=${refreshKey || Date.now()}`;
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

      {/* iframe */}
      <div className="relative flex-1 overflow-hidden">
        {/* Loading overlay */}
        {!ready && (
          <div
            className="absolute inset-0 flex items-center justify-center text-xs pointer-events-none"
            style={{ color: 'var(--color-muted)', zIndex: 1 }}
          >
            Loading preview...
          </div>
        )}
        <iframe
          ref={iframeRef}
          key={refreshKey}
          src={previewUrl}
          title="Site preview"
          className="w-full h-full border-0"
          onLoad={() => setReady(true)}
          style={{ minHeight: '600px' }}
        />
      </div>
    </div>
  );
}
