/**
 * Pure YouTube ID extractor — no React dependency.
 *
 * Extracted from components/shared/VideoEmbed.tsx so it can be imported by
 * pure .ts modules (e.g. local-business-schema.ts) without pulling in a React
 * component file. VideoEmbed.tsx imports from here.
 */

/** Extract an 11-char YouTube video ID from common URL shapes. */
export function parseYouTubeId(url?: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  // Bare ID.
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  let candidate: string | null = null;
  if (host === 'youtu.be') {
    candidate = u.pathname.slice(1);
  } else if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    if (u.pathname === '/watch') {
      candidate = u.searchParams.get('v');
    } else {
      const m = u.pathname.match(/^\/(?:embed|shorts|v)\/([^/?]+)/);
      candidate = m ? m[1]! : null;
    }
  }
  return candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
}
