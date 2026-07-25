import Image from 'next/image';
import Link from 'next/link';
import { PortableText, type PortableTextComponents } from '@portabletext/react';
import type { CsPortableTextBlock } from '@/lib/customsites-sanity';

interface Props {
  value: CsPortableTextBlock[] | null | undefined;
  className?: string;
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
      if (isInternal) {
        return <Link href={href}>{children}</Link>;
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
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
