import { parseYouTubeId } from '../../lib/parse-youtube-id';

export { parseYouTubeId };

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
