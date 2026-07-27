import Image from 'next/image';
import Link from 'next/link';
import { PortableText, type PortableTextComponents } from '@portabletext/react';
import type { CsPortableTextBlock } from '@/lib/customsites-sanity';

interface Props {
  value: CsPortableTextBlock[] | null | undefined;
  className?: string;
}

/** Pulls the plain text out of a PortableText mark's children when it's a
 * single text node — used to detect "the link text is literally the URL"
 * (e.g. a raw calawyers.org/... address dropped straight into a bio) so it
 * can be rendered more legibly than a full URL sitting mid-sentence. */
function extractPlainText(node: React.ReactNode): string | null {
  if (typeof node === 'string') return node;
  if (Array.isArray(node) && node.length === 1) return extractPlainText(node[0]);
  return null;
}

const BARE_URL_RE = /^(?:https?:\/\/|www\.)\S+$/i;

/** Shortens a bare-URL link label to a readable host + partial path instead
 * of dumping the full address into running text. The `href` itself is never
 * touched — only what's visibly rendered. */
function shortenUrlLabel(text: string, max = 40): string {
  const stripped = text.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  if (stripped.length <= max) return stripped;
  return `${stripped.slice(0, max - 1)}…`;
}

const components: PortableTextComponents = {
  block: {
    h2: ({ children }) => <h2>{children}</h2>,
    h3: ({ children }) => <h3>{children}</h3>,
    h4: ({ children }) => <h4>{children}</h4>,
    blockquote: ({ children }) => <blockquote>{children}</blockquote>,
    normal: ({ children }) => <p>{children}</p>,
  },
  marks: {
    strong: ({ children }) => <strong>{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
    link: ({ value, children }) => {
      const href: string | undefined = value?.href;
      if (!href) return <>{children}</>;
      const isInternal = href.startsWith('/') || href.startsWith('#');
      const plainText = extractPlainText(children);
      const isBareUrlLabel = Boolean(plainText && BARE_URL_RE.test(plainText.trim()));
      // Content note: the graceful fix belongs here (rendering), but the
      // cleaner long-term fix is authoring descriptive link text in Sanity
      // instead of pasting a raw URL as the label — flagged, not changed here.
      const label = isBareUrlLabel ? shortenUrlLabel(plainText!.trim()) : children;
      if (isInternal) {
        return <Link href={href}>{label}</Link>;
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={isBareUrlLabel ? 'cs-prose-url-link' : undefined}>
          {label}
        </a>
      );
    },
  },
  types: {
    image: ({ value }) => {
      const url: string | undefined = value?.url;
      if (!url) return null;
      const width = value?.dims?.width ?? 1200;
      const height = value?.dims?.height ?? 800;
      return (
        <figure>
          <span style={{ position: 'relative', display: 'block', width: '100%', aspectRatio: `${width} / ${height}` }}>
            <Image
              src={url}
              alt={value?.alt ?? ''}
              fill
              sizes="(max-width: 899px) 100vw, 760px"
              style={{ objectFit: 'cover', borderRadius: 12 }}
            />
          </span>
          {value?.caption ? <figcaption>{value.caption}</figcaption> : null}
        </figure>
      );
    },
  },
  list: {
    bullet: ({ children }) => <ul>{children}</ul>,
    number: ({ children }) => <ol>{children}</ol>,
  },
  listItem: {
    bullet: ({ children }) => <li>{children}</li>,
    number: ({ children }) => <li>{children}</li>,
  },
};

/** @portabletext/react renderer for csBody (Portable Text). Used for every
 * rich body field on Custom Sites — practice areas, publications, attorney
 * bios, rich-text blocks. */
export function Prose({ value, className }: Props) {
  if (!value || value.length === 0) return null;
  return (
    <div className={['cs-prose', className].filter(Boolean).join(' ')}>
      <PortableText value={value} components={components} />
    </div>
  );
}
