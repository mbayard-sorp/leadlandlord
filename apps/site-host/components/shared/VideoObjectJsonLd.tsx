import type { Bundle } from '../../lib/content';
import { buildVideoObjectJsonLd } from './local-business-schema';

interface Props {
  bundle: Bundle;
  /** Absolute canonical URL of the page, used as the URL base for resolution. */
  url: string;
}

/**
 * VideoObject JSON-LD for the hero YouTube embed.
 *
 * Self-suppresses (returns null) when any required signal is absent:
 *   - bundle.video_url — the YouTube URL set by the operator
 *   - a parseable YouTube video ID
 *   - bundle.video_upload_date — operator-entered in Sanity Studio
 *
 * Mount this next to <VideoEmbed> in each variant. It is inert until the
 * operator explicitly enters the upload date in Studio, preventing Google from
 * flagging an invalid VideoObject with a missing required field.
 */
export function VideoObjectJsonLd({ bundle, url }: Props) {
  const json = buildVideoObjectJsonLd(bundle, url);
  if (!json) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
