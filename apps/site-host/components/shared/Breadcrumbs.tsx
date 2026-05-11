interface BreadcrumbItem {
  name: string;
  /** Absolute or site-relative URL. */
  url: string;
}

interface Props {
  items: BreadcrumbItem[];
}

/**
 * Visible breadcrumb trail rendered above the page H1.
 * Mirrors the items passed to BreadcrumbJsonLd so both the visible trail
 * and the JSON-LD are always in sync. The last item is rendered as plain
 * text (current page — no link). All preceding items are linked.
 */
export function Breadcrumbs({ items }: Props) {
  if (items.length < 2) return null;

  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <ol>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={item.url}>
              {isLast ? (
                <span aria-current="page">{item.name}</span>
              ) : (
                <>
                  <a href={item.url}>{item.name}</a>
                  <span aria-hidden className="breadcrumbs-sep"> / </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
