interface Props {
  /** Markdown body. Supports h1/h2/h3, paragraphs, lists, links, **bold**, *italic*. */
  source: string;
  className?: string;
}

/**
 * Minimal markdown → HTML converter — Phase 1 doesn't need a full MDX compiler.
 * Used by inner pages (services, about, contact, blog) where we render the
 * generated `mdx` body. The home page uses bespoke variant components instead.
 */
export function Markdown({ source, className }: Props) {
  const html = render(source);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

function render(md: string): string {
  // Strip frontmatter if present.
  const body = md.replace(/^---[\s\S]*?---\n?/, '');
  const lines = body.split('\n');
  const out: string[] = [];
  let inList = false;
  let inP = false;
  let pBuf: string[] = [];

  function flushP() {
    if (inP) {
      out.push(`<p>${inline(pBuf.join(' '))}</p>`);
      pBuf = [];
      inP = false;
    }
  }
  function flushList() {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^# (.+)/.test(line)) {
      flushP();
      flushList();
      out.push(`<h1>${esc(line.replace(/^# /, ''))}</h1>`);
    } else if (/^## (.+)/.test(line)) {
      flushP();
      flushList();
      out.push(`<h2>${esc(line.replace(/^## /, ''))}</h2>`);
    } else if (/^### (.+)/.test(line)) {
      flushP();
      flushList();
      out.push(`<h3>${esc(line.replace(/^### /, ''))}</h3>`);
    } else if (/^- (.+)/.test(line)) {
      flushP();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(line.replace(/^- /, ''))}</li>`);
    } else if (line.trim() === '') {
      flushP();
      flushList();
    } else {
      flushList();
      inP = true;
      pBuf.push(line);
    }
  }
  flushP();
  flushList();
  return out.join('\n');
}

function inline(s: string): string {
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
