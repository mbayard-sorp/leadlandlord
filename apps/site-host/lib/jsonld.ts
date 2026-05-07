/**
 * Parse a Sanity-stored Schema.org JSON-LD blob. Content Engine sometimes
 * stamps it as a JSON string; Sanity's portable text/object fields can also
 * surface it as a parsed object. Accept both — return null when input is
 * empty or unparseable.
 */
export function parseJsonLd(input: unknown): Record<string, unknown> | null {
  if (!input) return null;
  if (typeof input === 'object') return input as Record<string, unknown>;
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}
