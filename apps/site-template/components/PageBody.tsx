import type { Bundle } from '../lib/content';

interface Props {
  page: Bundle['home'];
}

/**
 * Renders a page's MDX body as plain markdown using `dangerouslySetInnerHTML`.
 * Phase 1: minimal markdown→HTML conversion for headings/paragraphs/links/lists.
 * Phase 2 will swap to a real MDX compiler with custom components
 * (`<TrackingNumber />`, `<LeadForm />`, `<CallToAction />`).
 */
export function PageBody({ page }: Props) {
  const html = renderMarkdown(page.mdx);
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

function renderMarkdown(md: string): string {
  // Strip frontmatter if present.
  const noFrontmatter = md.replace(/^---[\s\S]*?---\n?/, '');
  const lines = noFrontmatter.split('\n');
  const out: string[] = [];
  let inList = false;

  for (const line of lines) {
    if (/^# (.+)/.test(line)) {
      flushList();
      out.push(`<h1>${escapeHtml(line.replace(/^# /, ''))}</h1>`);
    } else if (/^## (.+)/.test(line)) {
      flushList();
      out.push(`<h2>${escapeHtml(line.replace(/^## /, ''))}</h2>`);
    } else if (/^### (.+)/.test(line)) {
      flushList();
      out.push(`<h3>${escapeHtml(line.replace(/^### /, ''))}</h3>`);
    } else if (/^- (.+)/.test(line)) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineFormat(line.replace(/^- /, ''))}</li>`);
    } else if (line.trim() === '') {
      flushList();
      out.push('');
    } else {
      flushList();
      out.push(`<p>${inlineFormat(line)}</p>`);
    }
  }
  flushList();
  return out.join('\n');

  function flushList() {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  }
}

function inlineFormat(s: string): string {
  return escapeHtml(s)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
