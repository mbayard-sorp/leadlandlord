/**
 * Splits `heading` around the last occurrence of `accent`, so that one word
 * (Cuelit's "lit") can take the brand color. No accent, or no match, returns
 * the heading whole.
 */
export function splitHeadingAccent(
  heading: string,
  accent?: string | null,
): { before: string; accent: string; after: string } | null {
  const needle = accent?.trim();
  if (!needle) return null;
  const at = heading.lastIndexOf(needle);
  if (at < 0) return null;
  return { before: heading.slice(0, at), accent: needle, after: heading.slice(at + needle.length) };
}
