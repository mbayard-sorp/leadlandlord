import { describe, expect, it } from 'vitest';
import { indexToMarkdown } from './page-markdown';

describe('indexToMarkdown', () => {
  const items = [
    { title: 'Why Mulch Matters', path: '/blog/why-mulch.md' },
    { title: 'Turf Install Guide', path: '/blog/turf-install.md' },
  ];

  it('renders title, blockquote description, link list, and canonical footer', () => {
    const md = indexToMarkdown('Blog', 'Landscaping guides.', items, 'https://example.com/blog');
    expect(md).toContain('# Blog');
    expect(md).toContain('> Landscaping guides.');
    expect(md).toContain('- [Why Mulch Matters](/blog/why-mulch.md)');
    expect(md).toContain('- [Turf Install Guide](/blog/turf-install.md)');
    expect(md).toContain('Canonical URL: https://example.com/blog');
  });

  it('omits the blockquote when description is missing', () => {
    const md = indexToMarkdown('FAQ', undefined, items, 'https://example.com/faq');
    expect(md).not.toContain('>');
    expect(md).toContain('# FAQ');
  });

  it('emits a placeholder when there are no items', () => {
    const md = indexToMarkdown('Blog', 'Guides.', [], 'https://example.com/blog');
    expect(md).toContain('No items published yet.');
    expect(md).not.toContain('- [');
  });

  it('links point at .md twins so AI crawlers stay on the markdown surface', () => {
    const md = indexToMarkdown('Blog', undefined, items, 'https://example.com/blog');
    const links = [...md.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1] ?? '');
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      expect(href.endsWith('.md')).toBe(true);
    }
  });
});
