import { describe, expect, it } from 'vitest';
import { portableTextToMarkdown, pageBuilderToMarkdown } from './customsites-markdown';
import type { CsPortableTextBlock } from './customsites-sanity';

function block(overrides: Partial<CsPortableTextBlock> = {}): CsPortableTextBlock {
  return {
    _type: 'block',
    _key: `k${Math.random()}`,
    style: 'normal',
    children: [],
    markDefs: [],
    ...overrides,
  };
}

function span(text: string, marks: string[] = []) {
  return { _type: 'span', text, marks };
}

describe('portableTextToMarkdown', () => {
  it('renders a plain paragraph', () => {
    const blocks = [block({ children: [span('Hello world.')] })];
    expect(portableTextToMarkdown(blocks)).toBe('Hello world.');
  });

  it('renders headings h2-h4', () => {
    const blocks = [
      block({ style: 'h2', children: [span('Heading Two')] }),
      block({ style: 'h3', children: [span('Heading Three')] }),
      block({ style: 'h4', children: [span('Heading Four')] }),
    ];
    expect(portableTextToMarkdown(blocks)).toBe(
      ['## Heading Two', '### Heading Three', '#### Heading Four'].join('\n\n'),
    );
  });

  it('renders a blockquote', () => {
    const blocks = [block({ style: 'blockquote', children: [span('A wise quote.')] })];
    expect(portableTextToMarkdown(blocks)).toBe('> A wise quote.');
  });

  it('renders bold and italic marks', () => {
    const blocks = [
      block({
        children: [span('This is '), span('bold', ['strong']), span(' and '), span('italic', ['em']), span('.')],
      }),
    ];
    expect(portableTextToMarkdown(blocks)).toBe('This is **bold** and *italic*.');
  });

  it('renders internal and external links via markDefs', () => {
    const blocks = [
      block({
        children: [span('See our '), span('practice areas', ['link-1']), span('.')],
        markDefs: [{ _key: 'link-1', _type: 'link', href: '/practice-areas' }],
      }),
    ];
    expect(portableTextToMarkdown(blocks)).toBe('See our [practice areas](/practice-areas).');
  });

  it('renders a flat bullet list', () => {
    const blocks = [
      block({ listItem: 'bullet', level: 1, children: [span('First')] }),
      block({ listItem: 'bullet', level: 1, children: [span('Second')] }),
    ];
    expect(portableTextToMarkdown(blocks)).toBe('- First\n- Second');
  });

  it('renders a flat numbered list with sequential numbering', () => {
    const blocks = [
      block({ listItem: 'number', level: 1, children: [span('Step one')] }),
      block({ listItem: 'number', level: 1, children: [span('Step two')] }),
      block({ listItem: 'number', level: 1, children: [span('Step three')] }),
    ];
    expect(portableTextToMarkdown(blocks)).toBe('1. Step one\n2. Step two\n3. Step three');
  });

  it('renders a nested list with indentation and restarts nested numbering per parent', () => {
    const blocks = [
      block({ listItem: 'bullet', level: 1, children: [span('Parent A')] }),
      block({ listItem: 'number', level: 2, children: [span('Child A1')] }),
      block({ listItem: 'number', level: 2, children: [span('Child A2')] }),
      block({ listItem: 'bullet', level: 1, children: [span('Parent B')] }),
      block({ listItem: 'number', level: 2, children: [span('Child B1')] }),
    ];
    expect(portableTextToMarkdown(blocks)).toBe(
      ['- Parent A', '  1. Child A1', '  2. Child A2', '- Parent B', '  1. Child B1'].join('\n'),
    );
  });

  it('separates a list from surrounding paragraphs with blank lines', () => {
    const blocks = [
      block({ children: [span('Intro paragraph.')] }),
      block({ listItem: 'bullet', level: 1, children: [span('Item one')] }),
      block({ listItem: 'bullet', level: 1, children: [span('Item two')] }),
      block({ children: [span('Closing paragraph.')] }),
    ];
    expect(portableTextToMarkdown(blocks)).toBe(
      ['Intro paragraph.', '- Item one\n- Item two', 'Closing paragraph.'].join('\n\n'),
    );
  });

  it('renders an image member with alt and caption', () => {
    const blocks: CsPortableTextBlock[] = [
      { _type: 'image', _key: 'img-1', url: 'https://cdn.example.com/photo.jpg', alt: 'A courtroom', caption: 'The main hearing room.' },
    ];
    expect(portableTextToMarkdown(blocks)).toBe(
      '![A courtroom](https://cdn.example.com/photo.jpg)\n*The main hearing room.*',
    );
  });

  it('renders an image member with no caption', () => {
    const blocks: CsPortableTextBlock[] = [
      { _type: 'image', _key: 'img-2', url: 'https://cdn.example.com/photo2.jpg', alt: '' },
    ];
    expect(portableTextToMarkdown(blocks)).toBe('![](https://cdn.example.com/photo2.jpg)');
  });

  it('returns an empty string for empty or missing input', () => {
    expect(portableTextToMarkdown([])).toBe('');
    expect(portableTextToMarkdown(null)).toBe('');
    expect(portableTextToMarkdown(undefined)).toBe('');
  });

  it('skips unrecognized member types without throwing', () => {
    const blocks: CsPortableTextBlock[] = [
      { _type: 'someFutureEmbed', _key: 'x-1' },
      block({ children: [span('Still renders.')] }),
    ];
    expect(portableTextToMarkdown(blocks)).toBe('Still renders.');
  });
});

describe('pageBuilderToMarkdown', () => {
  it('renders a hero block as an H1 plus subheading', () => {
    const blocks = [
      { _type: 'csHeroBlock' as const, _key: 'h1', heading: 'Construction ADR Services', subheading: 'Mediation and arbitration for the construction industry.' },
    ];
    expect(pageBuilderToMarkdown(blocks)).toBe(
      '# Construction ADR Services\n\nMediation and arbitration for the construction industry.',
    );
  });

  it('renders an intro block with eyebrow, heading, and body', () => {
    const blocks = [
      {
        _type: 'csIntroBlock' as const,
        _key: 'i1',
        eyebrow: 'About',
        heading: "Mike's Story",
        body: [block({ children: [span('Three decades of practice.')] })],
      },
    ];
    expect(pageBuilderToMarkdown(blocks)).toBe('*About*\n\n## Mike\'s Story\n\nThree decades of practice.');
  });

  it('renders a practice grid block as a linked list', () => {
    const blocks = [
      {
        _type: 'csPracticeGridBlock' as const,
        _key: 'p1',
        heading: 'Practice Areas',
        mode: 'selected' as const,
        areas: [
          { _id: 'a1', title: 'Mediation', slug: 'mediation' },
          { _id: 'a2', title: 'Arbitration', slug: 'arbitration' },
        ],
      },
    ];
    expect(pageBuilderToMarkdown(blocks)).toBe(
      '## Practice Areas\n\n- [Mediation](/practice-areas/mediation)\n- [Arbitration](/practice-areas/arbitration)',
    );
  });

  it('filters out blocks that render no content', () => {
    const blocks = [
      { _type: 'csBadgeRowBlock' as const, _key: 'b1', badges: [] },
      { _type: 'csCtaBannerBlock' as const, _key: 'c1', heading: 'Ready to talk?' },
    ];
    expect(pageBuilderToMarkdown(blocks)).toBe('## Ready to talk?');
  });
});
