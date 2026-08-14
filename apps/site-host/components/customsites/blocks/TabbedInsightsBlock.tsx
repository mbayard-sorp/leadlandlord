import type { CsTabbedInsightsBlock } from '@/lib/customsites-sanity';
import { InsightsTabIcon } from '../icons';

interface Props {
  block: CsTabbedInsightsBlock;
  /** The public path of the page rendering this block (e.g. "/insights") —
   * passed down from the route so the active tab is matched server-side. */
  currentPath?: string;
}

/** Insights tabs — real links to real routes, not JS panels; each tab is
 * separately shareable. The active tab gets aria-current="page". */
export function TabbedInsightsBlock({ block, currentPath }: Props) {
  const tabs = block.tabs ?? [];
  if (tabs.length === 0) return null;

  return (
    <div className="cs-container" style={{ paddingBlock: 'var(--cs-space-5)' }}>
      {block.eyebrow ? <span className="cs-eyebrow">{block.eyebrow}</span> : null}
      <nav className="cs-tabs" aria-label="Insights sections">
        {tabs.map((tab) => {
          const isCurrent = Boolean(currentPath) && tab.href === currentPath;
          return (
            <a key={tab._key} href={tab.href} className="cs-tab" aria-current={isCurrent ? 'page' : undefined}>
              <InsightsTabIcon name={tab.icon} />
              <span>
                <strong>{tab.label}</strong>
                {tab.sublabel ? <span>{tab.sublabel}</span> : null}
              </span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
