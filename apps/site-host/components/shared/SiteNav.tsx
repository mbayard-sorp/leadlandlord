import type { Bundle } from '../../lib/content';

interface Props {
  bundle: Bundle;
  variant: 'classic' | 'modern' | 'bright' | 'premium' | 'haul' | 'counsel';
  className?: string;
}

/**
 * Variant-agnostic top nav primitive.
 *
 * Link visibility rules:
 * - Home, About, Contact: always present.
 * - Services: links to /#services (anchor) when no services; links to the
 *   first service slug when present, so there is a crawlable entry point.
 * - Service Areas: links to /#where anchor (always; map/areas section present
 *   on all variants).
 * - Blog: only rendered when bundle.blog_posts.length >= 2 to avoid thin-
 *   content indexing. The /blog index page enforces the same gate via noindex.
 */
export function SiteNav({ bundle, variant, className }: Props) {
  const firstService = bundle.services[0];
  const servicesHref = firstService ? firstService.slug : '/#services';
  const showBlog = bundle.blog_posts.length >= 2;

  return (
    <nav
      className={['site-nav', `${variant}-nav`, className].filter(Boolean).join(' ')}
      aria-label="Primary"
    >
      <a href="/">Home</a>
      <a href={servicesHref}>Services</a>
      <a href="/#where">Service Areas</a>
      {showBlog && <a href="/blog/">Blog</a>}
      <a href="/about/">About</a>
      <a href="/contact/">Contact</a>
    </nav>
  );
}
