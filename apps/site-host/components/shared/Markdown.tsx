import { Marked } from 'marked';

interface Props {
  source: string;
  className?: string;
}

const marked = new Marked({ gfm: true, breaks: false, async: false });

export function Markdown({ source, className }: Props) {
  const body = source.replace(/^---[\s\S]*?---\n?/, '');
  const html = marked.parse(body) as string;
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
