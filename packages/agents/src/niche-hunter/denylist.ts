/**
 * Niche denylist — categories that are high-fraud, legally problematic,
 * or dominated by national chains in ways that make rank-and-rent unviable.
 * Per build plan section 7.2 item 1e.
 */
export const NICHE_DENYLIST: string[] = [
  'locksmith',
  'garage door',
  'garage doors',
  'security camera',
  'security cameras',
  'alarm',
  'safe cracking',
  'key duplication',
];

/**
 * Returns true if the niche string contains any denylisted term (case-insensitive
 * substring match).
 */
export function isDenylisted(niche: string): boolean {
  const lower = niche.toLowerCase();
  return NICHE_DENYLIST.some((term) => lower.includes(term.toLowerCase()));
}
