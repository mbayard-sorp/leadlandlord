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

type DeviceWidth = 'desktop' | 'mobile';

interface LivePreviewProps {
  /** The Sanity doc ID for this site (bs-site-<uuid>). */
  sanityDocId: string;
  /** Increment to force an iframe reload (e.g. after a successful save). */
  refreshKey?: number;
  /**
   * Pre-computed draft-mode enable URL passed from EditorShell.
   * Avoids duplicating the URL construction logic here.
   */
  previewUrl?: string;
}

export default function LivePreview({ sanityDocId, refreshKey = 0, previewUrl }: LivePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [deviceWidth, setDeviceWidth] = useState<DeviceWidth>('desktop');

  const enableUrl = previewUrl ?? `/api/draft-mode/enable?redirect=/preview/${sanityDocId}`;

  // When refreshKey changes (after a save), reload the iframe.
  useEffect(() => {
    if (refreshKey === 0) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
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

  const iframeStyle: React.CSSProperties =
    deviceWidth === 'mobile'
      ? {
          width: '400px',
          maxWidth: '100%',
          height: '100%',
          border: '0',
          margin: '0 auto',
          display: 'block',
          transition: 'width 200ms ease',
        }
      : {
          width: '100%',
          height: '100%',
          border: '0',
          transition: 'width 200ms ease',
        };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b shrink-0"
        style={{
          background: 'var(--color-panel)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-muted)',
        }}
      >
        {/* Title + caption */}
        <div>
          <span className="text-sm font-semibold" style={{ color: 'var(--color-fg)' }}>
            Preview of your website
          </span>
          <span className="text-xs ml-2" style={{ color: 'var(--color-muted)' }}>
            Save to update it.
          </span>
        </div>

        {/* Toolbar controls */}
        <div className="flex items-center gap-1">
          {/* Device-width toggle */}
          <button
            type="button"
            onClick={() => setDeviceWidth((d) => (d === 'desktop' ? 'mobile' : 'desktop'))}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
            style={{ color: 'var(--color-accent)' }}
            title={deviceWidth === 'desktop' ? 'Switch to mobile view' : 'Switch to desktop view'}
            aria-label={deviceWidth === 'desktop' ? 'Switch to mobile view' : 'Switch to desktop view'}
          >
            {deviceWidth === 'desktop' ? (
              /* Phone icon */
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                <line x1="12" y1="18" x2="12.01" y2="18" />
              </svg>
            ) : (
              /* Monitor icon */
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            )}
            <span className="hidden lg:inline">
              {deviceWidth === 'desktop' ? 'Mobile' : 'Desktop'}
            </span>
          </button>

          {/* Refresh button */}
          <button
            type="button"
            onClick={handleManualRefresh}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
            style={{ color: 'var(--color-accent)' }}
            aria-label="Refresh preview"
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
            <span className="hidden lg:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* iframe container */}
      <div className="relative flex-1 overflow-auto" style={{ background: '#e2e8f0' }}>
        {/* Skeleton shimmer — shown while iframe is loading */}
        {!ready && (
          <div
            className="absolute inset-0 z-10 pointer-events-none"
            aria-hidden="true"
            style={{
              background: 'var(--color-panel)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              padding: '24px',
            }}
          >
            {/* Skeleton bars mimicking a page */}
            <div className="skeleton-shimmer rounded" style={{ height: '56px', borderRadius: '6px' }} />
            <div className="skeleton-shimmer rounded" style={{ height: '200px', borderRadius: '6px' }} />
            <div className="skeleton-shimmer rounded" style={{ height: '24px', width: '70%', borderRadius: '4px' }} />
            <div className="skeleton-shimmer rounded" style={{ height: '16px', width: '50%', borderRadius: '4px' }} />
            <div className="skeleton-shimmer rounded" style={{ height: '120px', borderRadius: '6px' }} />
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={enableUrl}
          title="Site preview"
          onLoad={() => setReady(true)}
          // The preview is a cross-origin iframe (site-host origin). Delegate the
          // clipboard permission so next-sanity's <SanityLive> reconnect handshake
          // (which calls clipboard.writeText) isn't blocked by permissions policy.
          allow="clipboard-write; clipboard-read"
          style={{ ...iframeStyle, minHeight: '600px' }}
        />
      </div>
    </div>
  );
}
