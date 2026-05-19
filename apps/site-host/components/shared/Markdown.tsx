import { Marked } from 'marked';
import { substitutePhone } from '../../lib/phone';

interface Props {
  source: string;
  className?: string;
  /** Tenant tracking phone — replaces `{{phone}}` tokens in the source. */
  phone?: string;
}

const marked = new Marked({ gfm: true, breaks: false, async: false });

export function Markdown({ source, className, phone }: Props) {
  const body = source.replace(/^---[\s\S]*?---\n?/, '');
  const substituted = phone ? substitutePhone(body, phone) : body;
  const html = marked.parse(substituted) as string;
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
