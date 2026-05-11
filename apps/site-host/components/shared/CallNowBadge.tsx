import type { Bundle } from '../../lib/content';

interface Props {
  bundle: Bundle;
}

/**
 * Inline microcopy badge driven by `response_time_promise`.
 * Renders nothing when the field is absent — ADR 0003 render-when-present.
 */
export function CallNowBadge({ bundle }: Props) {
  if (!bundle.response_time_promise) return null;

  return (
    <span className="call-now-badge" aria-label={bundle.response_time_promise}>
      <span className="call-now-badge-dot" aria-hidden />
      {bundle.response_time_promise}
    </span>
  );
}
