/**
 * Flatten markdown answer body to plain text for FAQPage `acceptedAnswer.text`.
 * Answer-engine extraction wants prose, not markdown syntax. Dependency-free and
 * deliberately lossy: strips headings/emphasis/links/lists, collapses
 * whitespace, and caps length so a long answer body doesn't bloat the JSON-LD.
 */
export function mdToText(md: string, maxLen = 600): string {
  const text = (md ?? '')
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/^\s*[-*+]\s+/gm, '') // bullet markers
    .replace(/^\s*\d+\.\s+/gm, '') // ordered markers
    .replace(/[*_~>]/g, '') // emphasis / blockquote marks
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLen) return text;
  // Cut on a word boundary, append ellipsis.
  return `${text.slice(0, maxLen).replace(/\s+\S*$/, '')}…`;
}
