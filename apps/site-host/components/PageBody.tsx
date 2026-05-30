import type { Bundle } from '../lib/content';
import { substitutePhone } from '../lib/phone';
import { renderMarkdown } from '../lib/markdown';

interface Props {
  page: Bundle['home'];
  /** Tenant tracking phone — replaces `{{phone}}` tokens in `page.mdx`. */
  phone?: string;
}

/**
 * Renders a page's MDX body as plain markdown using `dangerouslySetInnerHTML`.
 * The markdown→HTML conversion lives in `lib/markdown.ts` (shared with the
 * long-form home section).
 */
export function PageBody({ page, phone }: Props) {
  const mdx = phone ? substitutePhone(page.mdx, phone) : page.mdx;
  const html = renderMarkdown(mdx);
  return (
    <article>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {page.schema_org_jsonld != null && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(page.schema_org_jsonld) }}
        />
      )}
    </article>
  );
}
