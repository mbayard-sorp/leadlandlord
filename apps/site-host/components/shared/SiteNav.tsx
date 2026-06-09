import type { Bundle } from '../../lib/content';
import { pageHref } from '../../lib/content';

interface Props {
  bundle: Bundle;
  variant: 'classic' | 'modern' | 'bright' | 'premium' | 'haul' | 'counsel';
  className?: string;
  /**
   * When true, every page in the bundle is reachable from the nav: services,
   * service areas, info/article pages, and blog posts are grouped into menus.
   * Use on variants whose layout has no other in-page entry point to
   * article/blog pages.
   */
  showAllPages?: boolean;
}

interface MenuItem {
  href: string;
  title: string;
}

/**
 * A single nav group (Services / Service Areas / Guides / Blog). One markup,
 * two responsive behaviors driven purely by CSS (see styles/site-nav.css), no
 * client JS:
 *
 * - Desktop: the trigger is a hover/focus target; `.nav-menu` is an absolute
 *   dropdown revealed on :hover / :focus-within and closed on leave.
 * - Mobile: inside the hamburger drawer the section renders expanded — the
 *   trigger is a heading link and every item is listed beneath it (no hover).
 *
 * The trigger is a real link to `href` (section index / first page) so it is
 * useful on touch and reachable by keyboard.
 */
function NavMenu({ label, href, items }: { label: string; href: string; items: MenuItem[] }) {
  return (
    <div className="nav-group">
      <a className="nav-group-label" href={href} aria-haspopup="true">
        <span>{label}</span>
        <span className="nav-caret" aria-hidden>
          &#x25BE;
        </span>
      </a>
      <ul className="nav-menu">
        {items.map((it) => (
          <li key={it.href}>
            <a href={it.href}>{it.title}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Variant-agnostic top nav primitive.
 *
 * Link visibility rules (condensed default):
 * - Home, About, Contact: always present.
 * - Services: links to /#services (anchor) when no services; links to the
 *   first service slug when present, so there is a crawlable entry point.
 * - Service Areas: links to /#where anchor (always; map/areas section present
 *   on all variants).
 * - Blog: only rendered when bundle.blog_posts.length >= 2 to avoid thin-
 *   content indexing. The /blog index page enforces the same gate via noindex.
 *
 * With showAllPages, those groups expand into menus that link every individual
 * page, wrapped in a responsive hamburger drawer (desktop bar / mobile drawer).
 */
export function SiteNav({ bundle, variant, className, showAllPages }: Props) {
  const navClass = ['site-nav', `${variant}-nav`, className].filter(Boolean).join(' ');

  if (showAllPages) {
    const serviceItems = bundle.services.map((p) => ({ href: pageHref(p), title: p.title }));
    const areaItems = bundle.service_areas.map((p) => ({ href: pageHref(p), title: p.title }));
    const guideItems = bundle.info_pages.map((p) => ({ href: pageHref(p), title: p.title }));
    const blogItems = bundle.blog_posts.map((p) => ({ href: pageHref(p), title: p.title }));
    const faqItems = bundle.faq_pages.map((p) => ({ href: pageHref(p), title: p.title }));
    const showBlog = bundle.blog_posts.length >= 2;
    const showFaq = bundle.faq_pages.length >= 2;

    return (
      // Mobile: the checkbox toggles a hamburger drawer. Desktop: CSS hides the
      // toggle and the nav is always a horizontal bar. No client JS.
      <div className="site-nav-shell">
        <input type="checkbox" id="ll-nav-toggle" className="nav-toggle-input" />
        <label htmlFor="ll-nav-toggle" className="nav-hamburger">
          <span className="nav-burger" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          <span className="nav-hamburger-label">Menu</span>
        </label>
        <nav className={`${navClass} site-nav--menu`} aria-label="Primary">
          <a href="/">Home</a>
          {serviceItems.length > 0 ? (
            <NavMenu
              label="Services"
              href="/#services"
              items={[{ href: '/#services', title: 'All services' }, ...serviceItems]}
            />
          ) : (
            <a href="/#services">Services</a>
          )}
          {areaItems.length > 0 ? (
            <NavMenu label="Service Areas" href="/#where" items={areaItems} />
          ) : (
            <a href="/#where">Service Areas</a>
          )}
          {guideItems.length > 0 && (
            <NavMenu label="Guides" href={guideItems[0]!.href} items={guideItems} />
          )}
          {showFaq && (
            <NavMenu
              label="FAQ"
              href="/faq"
              items={[{ href: '/faq', title: 'All questions' }, ...faqItems]}
            />
          )}
          {showBlog && (
            <NavMenu
              label="Blog"
              href="/blog"
              items={[{ href: '/blog', title: 'All articles' }, ...blogItems]}
            />
          )}
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
        </nav>
      </div>
    );
  }

  const firstService = bundle.services[0];
  const servicesHref = firstService ? pageHref(firstService) : '/#services';
  const showBlog = bundle.blog_posts.length >= 2;
  const showFaq = bundle.faq_pages.length >= 2;

  return (
    <nav className={navClass} aria-label="Primary">
      <a href="/">Home</a>
      <a href={servicesHref}>Services</a>
      <a href="/#where">Service Areas</a>
      {showFaq && <a href="/faq">FAQ</a>}
      {showBlog && <a href="/blog">Blog</a>}
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
    </nav>
  );
}
