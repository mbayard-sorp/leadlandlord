'use client';

import { useState } from 'react';
import { DecisionButtons } from './DecisionButtons';
import { BuildLink } from './BuildLink';
import { ValidateButton } from './ValidateButton';
import { CalibrationContent } from './CalibrationDrawer';
import { DeleteNicheButton } from './DeleteNicheButton';

// flip to true to revisit the scoring algorithm calibration view
const SHOW_CALIBRATION = false;

export type NicheRowData = {
  id: string;
  niche: string;
  city: string;
  state: string;
  searchVolume: number | null;
  kd: number | null;
  estAvgJobValueUsd: string | null;
  estCloseRate: string | null;
  score: string | null;
  rationale: string | null;
  volumeSource: string;
  estSearchVolume: number | null;
  dfsSearchVolume: number | null;
  dfsClusterVolume: number | null;
  dfsKd: number | null;
  validatedAt: Date | null;
  dfsRaw: unknown;
  decision: string;
  contractorCount: number | null;
  rentabilityScore: string | null;
};

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-2 ${className}`}>{children}</td>;
}

function VolCell({ row }: { row: NicheRowData }) {
  const isValidated = row.volumeSource === 'dataforseo';
  const estimate = row.estSearchVolume ?? row.searchVolume;

  if (isValidated && row.dfsSearchVolume !== null) {
    return (
      <span className="text-xs">
        {estimate !== null ? <span className="text-slate-400">{estimate} est</span> : null}
        {estimate !== null ? <span className="text-slate-500"> → </span> : null}
        <span className="text-emerald-400 font-medium">{row.dfsSearchVolume} DFS</span>
      </span>
    );
  }

  if (estimate !== null) {
    return <span className="text-xs text-slate-400">{estimate} est</span>;
  }

  return <span className="text-slate-500">—</span>;
}

function SourceBadge({ volumeSource }: { volumeSource: string }) {
  if (volumeSource === 'dataforseo') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs font-medium text-emerald-300 border border-emerald-800">
        validated
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-400 border border-slate-700">
      estimate
    </span>
  );
}

export function NicheRow({
  row,
  showButtons = false,
  showBuildLink = false,
  showDelete = false,
  siteId,
  colSpan,
  geoSharePrior,
  demandUsed,
  demandSource,
}: {
  row: NicheRowData;
  showButtons?: boolean;
  showBuildLink?: boolean;
  showDelete?: boolean;
  siteId?: string | null;
  colSpan: number;
  geoSharePrior: number;
  demandUsed: number;
  demandSource: 'dataforseo' | 'claude_estimate';
}) {
  const [calOpen, setCalOpen] = useState(false);
  const hasCalibration = row.dfsClusterVolume !== null;

  return (
    <>
      <tr className="border-b border-slate-800/60 last:border-0">
        <Td className="break-words">
          {row.niche}
          <div className="text-xs text-slate-500 md:hidden">
            {row.city}, {row.state}
          </div>
        </Td>
        <Td className="hidden md:table-cell">
          {row.city}, {row.state}
        </Td>
        <Td className="font-semibold">{row.score ?? '—'}</Td>
        <Td className="hidden lg:table-cell">
          {row.rentabilityScore !== null ? (
            <span className="font-medium text-violet-400">{row.rentabilityScore}</span>
          ) : (
            <span className="text-slate-500">—</span>
          )}
        </Td>
        <Td className="hidden md:table-cell">
          <VolCell row={row} />
        </Td>
        <Td className="hidden md:table-cell">
          <SourceBadge volumeSource={row.volumeSource} />
        </Td>
        <Td className="hidden lg:table-cell">
          {row.estAvgJobValueUsd ? `$${Number(row.estAvgJobValueUsd).toLocaleString()}` : '—'}
        </Td>
        <Td className="text-xs text-slate-400 max-w-md hidden lg:table-cell">
          <p className="line-clamp-2">{row.rationale}</p>
          {SHOW_CALIBRATION && hasCalibration && (
            <button
              type="button"
              onClick={() => setCalOpen((v) => !v)}
              className="mt-1 text-xs text-amber-400 hover:text-amber-300 underline-offset-2 hover:underline"
            >
              {calOpen ? 'Hide calibration' : 'View calibration'}
            </button>
          )}
        </Td>
        <Td>
          <div className="flex flex-col gap-1">
            <ValidateButton nicheId={row.id} alreadyValidated={row.volumeSource === 'dataforseo'} />
            {showDelete && <DeleteNicheButton id={row.id} />}
          </div>
        </Td>
        {showButtons && (
          <Td>
            <DecisionButtons id={row.id} volumeSource={row.volumeSource} />
          </Td>
        )}
        {showBuildLink && (
          <Td>
            <BuildLink nicheId={row.id} initialSiteId={siteId ?? null} />
          </Td>
        )}
      </tr>
      {calOpen && hasCalibration && (
        <tr className="border-b border-slate-800/60 bg-slate-950/40">
          <td colSpan={colSpan} className="px-3 pb-3 pt-0">
            <CalibrationContent
              claudeEstimate={row.estSearchVolume ?? row.searchVolume}
              dfsSeedVolume={row.dfsSearchVolume}
              clusterVolume={row.dfsClusterVolume}
              geoSharePrior={geoSharePrior}
              demandUsed={demandUsed}
              demandSource={demandSource}
              score={row.score}
            />
          </td>
        </tr>
      )}
    </>
  );
}
