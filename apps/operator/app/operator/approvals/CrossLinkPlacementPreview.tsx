import { getDb, sites, inArray } from '@leadlandlord/db';
import { CrossLinkPlacementPayload } from '@leadlandlord/shared';

const TOPOLOGY_LABELS: Record<string, string> = {
  'same-niche-different-city': 'Same niche / different city',
  'same-city-different-niche': 'Same city / different niche',
  'out-of-network': 'Out of network',
};

const TOPOLOGY_COLORS: Record<string, string> = {
  'same-niche-different-city': 'bg-sky-900/40 text-sky-300 border-sky-700/50',
  'same-city-different-niche': 'bg-violet-900/40 text-violet-300 border-violet-700/50',
  'out-of-network': 'bg-amber-900/40 text-amber-300 border-amber-700/50',
};

function highlightAnchor(sentence: string, anchor: string): React.ReactNode {
  const idx = sentence.indexOf(anchor);
  if (idx === -1) return sentence;
  return (
    <>
      {sentence.slice(0, idx)}
      <mark className="bg-yellow-300/20 text-yellow-200 rounded px-0.5">{anchor}</mark>
      {sentence.slice(idx + anchor.length)}
    </>
  );
}

interface Props {
  payload: unknown;
}

export async function CrossLinkPlacementPreview({ payload }: Props) {
  const parsed = CrossLinkPlacementPayload.safeParse(payload);
  if (!parsed.success) {
    return (
      <span className="text-red-400 text-xs">Invalid cross_link_placement payload</span>
    );
  }

  const p = parsed.data;
  const db = getDb();

  const siteRows = await db
    .select({ id: sites.id, niche: sites.niche, city: sites.city, state: sites.state })
    .from(sites)
    .where(inArray(sites.id, [p.sourceSiteId, p.targetSiteId]));

  const siteMap = Object.fromEntries(siteRows.map((s) => [s.id, s]));
  const src = siteMap[p.sourceSiteId];
  const tgt = siteMap[p.targetSiteId];

  const srcLabel = src ? `${src.niche} — ${src.city}, ${src.state}` : p.sourceSiteId;
  const tgtLabel = tgt ? `${tgt.niche} — ${tgt.city}, ${tgt.state}` : p.targetSiteId;

  const topologyColor =
    TOPOLOGY_COLORS[p.topology] ?? 'bg-slate-800 text-slate-300 border-slate-700';

  return (
    <div className="space-y-2 text-sm">
      {/* Topology badge */}
      <span
        className={`inline-block text-xs px-2 py-0.5 rounded border font-medium ${topologyColor}`}
      >
        {TOPOLOGY_LABELS[p.topology] ?? p.topology}
      </span>

      {/* Source -> Target */}
      <div className="text-slate-300">
        <span className="text-slate-500">from </span>
        <span className="font-medium">{srcLabel}</span>
        <span className="text-slate-500"> / </span>
        <code className="text-xs bg-slate-800 px-1 rounded">{p.sourcePageSlug}</code>
        <span className="text-slate-500"> → </span>
        <a
          href={p.targetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 hover:text-sky-300"
        >
          {tgtLabel} ↗
        </a>
      </div>

      {/* Anchor text */}
      <div>
        <span className="text-slate-500 text-xs">anchor: </span>
        <code className="text-xs bg-slate-800 px-1.5 py-0.5 rounded text-slate-200">
          {p.anchorText}
        </code>
      </div>

      {/* Before / after diff */}
      <div className="space-y-1 rounded border border-slate-800 bg-slate-900/60 p-2 text-xs">
        <div className="text-slate-500 uppercase tracking-wide text-[10px] mb-1">Sentence diff</div>
        <div className="text-slate-400 line-through">{p.beforeSentence}</div>
        <div className="text-slate-200">{highlightAnchor(p.afterSentence, p.anchorText)}</div>
      </div>

      {/* Rationale */}
      {p.rationale && (
        <div className="text-xs text-slate-500 italic">{p.rationale}</div>
      )}
    </div>
  );
}
