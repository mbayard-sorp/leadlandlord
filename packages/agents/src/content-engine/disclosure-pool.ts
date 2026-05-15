import { createHash } from 'node:crypto';

/**
 * Deterministic disclosure-string pool. Each entry is a legally-equivalent
 * variant of the lead-generation disclosure required on every page footer.
 * Hash-pick by siteId ensures consistent selection per site and variation
 * across the portfolio.
 */
const POOL: string[] = [
  'This site connects callers with a partnered local service provider.',
  'Calls and form submissions are routed to a local partner in your area.',
  'This website is operated by a lead-generation service. Inquiries are forwarded to a local licensed provider.',
  'We match homeowners with local service professionals. Submitting a request connects you with a partner provider.',
  'This site is a lead referral service. Your contact information will be shared with a licensed local contractor.',
  'By calling or submitting this form, you consent to be contacted by a partner local service provider.',
  'This site facilitates connections between consumers and local home-service contractors.',
  'Inquiries submitted here are directed to a vetted local provider who will follow up directly.',
];

function hashPickIndex(seed: string, poolSize: number): number {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 8);
  return parseInt(hex, 16) % poolSize;
}

/**
 * Returns a single disclosure string deterministically selected for the given
 * siteId. Same siteId always returns the same string; different siteIds
 * distribute across all pool variants.
 */
export function getDisclosure(siteId: string): string {
  const idx = hashPickIndex(siteId, POOL.length);
  return POOL[idx]!;
}
