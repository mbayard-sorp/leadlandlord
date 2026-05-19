/**
 * wave-launcher/state-machine.ts
 *
 * Pure state-machine for wave progression. No DB writes — all side effects
 * live in the caller (wave-launcher/index.ts).
 */

export type WaveStateName =
  | 'draft'
  | 'launching'
  | 'aging'
  | 'linking'
  | 'backlinking'
  | 'monitoring'
  | 'completed';

export interface WaveSignals {
  approvedCandidateCount: number;
  siteCount: number;
  builtSiteCount: number;
  agingUntil: Date | null;
  now: Date;
  indexedSiteCount: number;
  linkPlacementsPerSite: Record<string, number>;
  backlinksPerSite: Record<string, number>;
  monitoringWeeksElapsed: number;
}

export interface TransitionEval {
  toState: WaveStateName | null;
  blockers: string[];
  evidence: Record<string, unknown>;
}

export function evaluateTransition(
  currentState: WaveStateName,
  signals: WaveSignals,
): TransitionEval {
  switch (currentState) {
    case 'draft':
      return evalDraft(signals);
    case 'launching':
      return evalLaunching(signals);
    case 'aging':
      return evalAging(signals);
    case 'linking':
      return evalLinking(signals);
    case 'backlinking':
      return evalBacklinking(signals);
    case 'monitoring':
      return evalMonitoring(signals);
    case 'completed':
      return { toState: null, blockers: ['wave is already completed'], evidence: {} };
  }
}

function evalDraft(signals: WaveSignals): TransitionEval {
  const blockers: string[] = [];
  const { approvedCandidateCount, siteCount } = signals;

  if (siteCount < 3 || siteCount > 5) {
    blockers.push(`need 3-5 sites, have ${siteCount}`);
  }
  if (approvedCandidateCount < siteCount) {
    blockers.push(
      `need ${siteCount} approved candidates, have ${approvedCandidateCount}`,
    );
  }

  return {
    toState: blockers.length === 0 ? 'launching' : null,
    blockers,
    evidence: { approvedCandidateCount, siteCount },
  };
}

function evalLaunching(signals: WaveSignals): TransitionEval {
  const blockers: string[] = [];
  const { builtSiteCount, siteCount } = signals;

  if (builtSiteCount !== siteCount) {
    blockers.push(`waiting for all sites to build: ${builtSiteCount}/${siteCount} done`);
  }

  return {
    toState: blockers.length === 0 ? 'aging' : null,
    blockers,
    evidence: { builtSiteCount, siteCount },
  };
}

function evalAging(signals: WaveSignals): TransitionEval {
  const blockers: string[] = [];
  const { agingUntil, now, indexedSiteCount, siteCount } = signals;

  if (agingUntil === null) {
    blockers.push('agingUntil not set');
  } else if (now < agingUntil) {
    blockers.push(
      `agingUntil ${agingUntil.toISOString().slice(0, 10)} not yet reached (now ${now.toISOString().slice(0, 10)})`,
    );
  }

  if (indexedSiteCount < siteCount) {
    blockers.push(
      `waiting for all sites to be indexed: ${indexedSiteCount}/${siteCount} indexed`,
    );
  }

  return {
    toState: blockers.length === 0 ? 'linking' : null,
    blockers,
    evidence: { agingUntil: agingUntil?.toISOString() ?? null, indexedSiteCount, siteCount },
  };
}

function evalLinking(signals: WaveSignals): TransitionEval {
  const blockers: string[] = [];
  const { linkPlacementsPerSite } = signals;

  const underLinked = Object.entries(linkPlacementsPerSite).filter(([, count]) => count < 2);
  if (underLinked.length > 0) {
    blockers.push(
      `${underLinked.length} site(s) have fewer than 2 link placements: ${underLinked.map(([id, c]) => `${id}(${c})`).join(', ')}`,
    );
  }

  return {
    toState: blockers.length === 0 ? 'backlinking' : null,
    blockers,
    evidence: { linkPlacementsPerSite },
  };
}

function evalBacklinking(signals: WaveSignals): TransitionEval {
  const { backlinksPerSite } = signals;

  const missingBacklinks = Object.entries(backlinksPerSite).filter(([, count]) => count < 1);

  if (missingBacklinks.length === 0) {
    return {
      toState: 'monitoring',
      blockers: [],
      evidence: { backlinksPerSite },
    };
  }

  // Backlink agents not yet implemented — stub advance with skipBacklinks evidence.
  return {
    toState: 'monitoring',
    blockers: [],
    evidence: {
      backlinksPerSite,
      skipBacklinks: true,
      reason: 'backlink agents not yet implemented',
    },
  };
}

function evalMonitoring(signals: WaveSignals): TransitionEval {
  const blockers: string[] = [];
  const { monitoringWeeksElapsed } = signals;

  if (monitoringWeeksElapsed < 4) {
    blockers.push(
      `monitoring period not complete: ${monitoringWeeksElapsed}/4 weeks elapsed`,
    );
  }

  return {
    toState: blockers.length === 0 ? 'completed' : null,
    blockers,
    evidence: { monitoringWeeksElapsed },
  };
}
