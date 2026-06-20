'use client';

import { useIsPresentationTool } from 'next-sanity/hooks';

/**
 * Renders a fixed "Exit preview" link unless we are already inside the
 * Sanity Presentation iframe, where the built-in chrome handles it.
 * Only mounted when draftMode().isEnabled (enforced by the layout).
 */
export function DisableDraftMode() {
  const inPresentation = useIsPresentationTool();
  if (inPresentation) return null;

  return (
    <a
      href="/api/draft-mode/disable"
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        zIndex: 9999,
        background: '#1a1a1a',
        color: '#fff',
        fontSize: '0.8rem',
        fontFamily: 'system-ui, sans-serif',
        padding: '0.5rem 0.875rem',
        borderRadius: '0.375rem',
        textDecoration: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
      }}
    >
      Exit preview
    </a>
  );
}
