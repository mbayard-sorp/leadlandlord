interface Props {
  /** YouTube URL in watch, youtu.be, shorts, or embed form. */
  url?: string;
  /** Optional caption shown beneath the player. */
  description?: string;
  /** Outer section class — variants pass `"ll-video <variant>-video"` for theming. */
  className?: string;
}

/**
 * YouTube embed shown directly under the hero. Manual-entry only — operators
 * set the URL in Sanity. Renders nothing when the URL is missing or unparseable
 * so existing sites are unaffected until a video is added.
 *
 * Uses the privacy-enhanced `youtube-nocookie.com` host and lazy-loads the
 * iframe to keep it off the critical path.
 */
export function VideoEmbed({ url, description, className }: Props) {
  const id = parseYouTubeId(url);
  if (!id) return null;
  return (
    <section className={className ?? 'll-video'} aria-label="Video">
      <div className="ll-video-frame">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}`}
          title="Video"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
      {description ? <p className="ll-video-desc">{description}</p> : null}
    </section>
  );
}

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
