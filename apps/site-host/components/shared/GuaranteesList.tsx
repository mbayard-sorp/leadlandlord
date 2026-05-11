import type { Bundle } from '../../lib/content';

interface Props {
  bundle: Bundle;
}

/**
 * Bulleted list of guarantees with checkmark glyphs.
 * Renders nothing when `bundle.guarantees` is empty — ADR 0003.
 */
export function GuaranteesList({ bundle }: Props) {
  if (bundle.guarantees.length === 0) return null;

  return (
    <ul className="guarantees-list" aria-label="Our guarantees">
      {bundle.guarantees.map((g) => (
        <li key={g} className="guarantees-item">
          <span className="guarantees-check" aria-hidden>✓</span>
          {g}
        </li>
      ))}
    </ul>
  );
}
