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
  category: string | null;
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
  estMonthlyValueUsd: string | null;
  validatedMonthlyValueUsd: string | null;
  annotations: unknown;
};

interface NicheAnnotations {
  seasonality?: string | null;
  licensing_concern?: string | null;
  caution?: string | null;
}

function parseAnnotations(raw: unknown): NicheAnnotations | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as NicheAnnotations;
  if (!a.seasonality && !a.licensing_concern && !a.caution) return null;
  return a;
}

function ValueCell({ row }: { row: NicheRowData }) {
  if (row.validatedMonthlyValueUsd !== null) {
    return (
      <span className="text-xs font-medium text-emerald-400">
        ${Number(row.validatedMonthlyValueUsd).toFixed(0)}/mo val
      </span>
    );
  }
  if (row.estMonthlyValueUsd !== null) {
    return (
      <span className="text-xs text-slate-400">${Number(row.estMonthlyValueUsd).toFixed(0)}/mo est</span>
    );
  }
  return <span className="text-slate-500">—</span>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-2 ${className}`}>{children}</td>;
}

export const CATEGORY_LABELS: Record<string, string> = {
  home_services: 'Home Services',
  auto: 'Auto',
  health: 'Health',
  professional: 'Professional',
  pet: 'Pet',
  event: 'Event',
  lifestyle: 'Lifestyle',
  legal: 'Legal',
  medical: 'Medical',
};

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return <span className="text-slate-600">—</span>;
  const label = CATEGORY_LABELS[category] ?? category;
  return (
    <span className="inline-flex w-fit items-center rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 border border-slate-700">
      {label}
    </span>
  );
}

function VolCell({ row }: { row: NicheRowData }) {
  const isValidated = row.volumeSource === 'dataforseo';
  const estimate = row.estSearchVolume ?? row.searchVolume;

  if (isValidated && row.dfsSearchVolume !== null) {
    return <span className="text-xs font-medium text-emerald-400">{row.dfsSearchVolume} DFS</span>;
  }

  if (estimate !== null) {
    return <span className="text-xs text-slate-400">{estimate} est</span>;
  }

  return <span className="text-slate-500">—</span>;
}

export function NicheRow({
  row,
  showButtons = false,
  showBuildLink = false,
  showDelete = false,
  siteId,
  colSpan,
  demandUsed,
  demandSource,
}: {
  row: NicheRowData;
  showButtons?: boolean;
  showBuildLink?: boolean;
  showDelete?: boolean;
  siteId?: string | null;
  colSpan: number;
  demandUsed: number;
  demandSource: 'dataforseo' | 'claude_estimate';
}) {
  const [calOpen, setCalOpen] = useState(false);
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const hasCalibration = row.dfsClusterVolume !== null;
  const isValidated = row.volumeSource === 'dataforseo';
  const annotations = parseAnnotations(row.annotations);

  return (
    <>
      <tr className="border-b border-slate-800/60 last:border-0">
        <Td className="whitespace-nowrap align-middle">
          <CategoryBadge category={row.category} />
        </Td>
        <Td className="break-words">
          {row.niche}
          <div className="text-xs text-slate-500 md:hidden">
            {row.city}, {row.state}
          </div>
        </Td>
        <Td className="hidden md:table-cell">
          {row.city}, {row.state}
        </Td>
        <Td className="align-middle whitespace-nowrap">
          <ValueCell row={row} />
        </Td>
        <Td className="font-semibold align-middle">
          {isValidated ? <span className="text-slate-600">—</span> : (row.score ?? '—')}
        </Td>
        <Td className="hidden lg:table-cell align-middle">
          {row.rentabilityScore !== null ? (
            <span className="font-medium text-violet-400">{row.rentabilityScore}</span>
          ) : (
            <span className="text-slate-500">—</span>
          )}
        </Td>
        <Td className="hidden md:table-cell align-middle">
          <VolCell row={row} />
        </Td>
        <Td className="hidden lg:table-cell align-middle">
          {row.estAvgJobValueUsd ? `$${Number(row.estAvgJobValueUsd).toLocaleString()}` : '—'}
        </Td>
        <Td className="text-xs text-slate-400 max-w-md hidden lg:table-cell align-top">
          {annotations && (
            <div className="mb-1 space-y-0.5">
              {annotations.seasonality && (
                <p className="text-[11px] text-sky-300">Seasonality: {annotations.seasonality}</p>
              )}
              {annotations.licensing_concern && (
                <p className="text-[11px] text-amber-300">Licensing: {annotations.licensing_concern}</p>
              )}
              {annotations.caution && (
                <p className="text-[11px] text-red-300">Caution: {annotations.caution}</p>
              )}
            </div>
          )}
          <div className="flex items-start gap-1.5">
            <p className={`flex-1 ${rationaleOpen ? '' : 'line-clamp-3'}`}>{row.rationale}</p>
            {row.rationale && (
              <button
                type="button"
                onClick={() => setRationaleOpen((v) => !v)}
                aria-label={rationaleOpen ? 'Collapse rationale' : 'Expand rationale'}
                title={rationaleOpen ? 'Collapse' : 'Expand'}
                className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-slate-600 text-slate-300 leading-none hover:border-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                {rationaleOpen ? '−' : '+'}
              </button>
            )}
          </div>
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
