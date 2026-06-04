/**
 * Pure gap-detection for the content-data-auditor.
 *
 * Maps operator-captured proprietary inputs (siteOriginalDataInputs) + computed
 * metrics (siteNetworkMetrics) to the four NON-COMMODITY content templates. Each
 * detected gap becomes a recommendation the auditor writes for human approval —
 * the auditor NEVER auto-applies and NEVER originates a claim.
 *
 * Anti-fabrication contract, enforced here:
 *  - 'original_case_study'   requires operator caseStudyInputs (seeds the story).
 *  - 'original_firsthand'    requires operator firsthandInputs.
 *  - 'original_contrarian'   requires operator contrarianTakes.
 *  - 'original_data_study'   requires a siteNetworkMetrics row with
 *                            sampleSize >= MIN_SAMPLE. The ONLY numbers that may
 *                            reach the writer are copied verbatim from that
 *                            metric's `value`; the gap carries no invented stats.
 *
 * "Published page already exists" suppresses a gap so we don't re-propose work.
 */

export const MIN_SAMPLE = 30;

export type TemplateType =
  | 'original_case_study'
  | 'original_data_study'
  | 'original_firsthand'
  | 'original_contrarian';

export interface DataInputsView {
  caseStudyInputs: Array<Record<string, unknown>>;
  firsthandInputs: Array<Record<string, unknown>>;
  contrarianTakes: Array<Record<string, unknown>>;
}

export interface MetricView {
  metricKind: string;
  /** Verbatim metric body — the ONLY facts a data-study may cite. */
  value: Record<string, unknown>;
  sampleSize: number;
}

export interface PublishedView {
  /** True when a published case-study page already exists for the site. */
  hasCaseStudyPage: boolean;
  /** True when a published data-study page already exists for the site. */
  hasDataStudyPage: boolean;
}

export interface Gap {
  template: TemplateType;
  /** Short human-readable reason the gap was raised. */
  reason: string;
  /**
   * Verbatim facts the writer is allowed to use. For data studies this is the
   * exact metric value + sampleSize; for the operator-seeded templates it
   * references the seed inputs. NEVER fabricated.
   */
  dataInputsRef: Record<string, unknown>;
}

export interface DetectGapsArgs {
  dataInputs: DataInputsView | null;
  metrics: MetricView[];
  published: PublishedView;
  /** Override the publishable-sample threshold (tests). */
  minSample?: number;
}

/**
 * Detect which of the four non-commodity templates have an unfilled, grounded
 * opportunity for this site. Pure: no DB, no LLM, no fabrication.
 */
export function detectGaps(args: DetectGapsArgs): Gap[] {
  const { dataInputs, metrics, published } = args;
  const minSample = args.minSample ?? MIN_SAMPLE;
  const gaps: Gap[] = [];

  // 1. original_case_study — operator has case-study seeds and no published page.
  const caseSeeds = dataInputs?.caseStudyInputs ?? [];
  if (caseSeeds.length > 0 && !published.hasCaseStudyPage) {
    gaps.push({
      template: 'original_case_study',
      reason: `${caseSeeds.length} operator case-study seed(s) present with no published case-study page.`,
      dataInputsRef: { source: 'caseStudyInputs', seedCount: caseSeeds.length, seeds: caseSeeds },
    });
  }

  // 2. original_data_study — a metric with enough samples and no published page.
  //    Pick the highest-sampleSize qualifying metric so the study cites the most
  //    defensible number. ONLY that metric's value travels forward.
  const qualifying = metrics
    .filter((m) => m.sampleSize >= minSample)
    .sort((a, b) => b.sampleSize - a.sampleSize);
  if (qualifying.length > 0 && !published.hasDataStudyPage) {
    const m = qualifying[0]!;
    gaps.push({
      template: 'original_data_study',
      reason: `metric '${m.metricKind}' has sampleSize ${m.sampleSize} (>= ${minSample}) and no published data-study page.`,
      // Verbatim copy — no synthesis, no rounding, no derived stats.
      dataInputsRef: {
        source: 'siteNetworkMetrics',
        metricKind: m.metricKind,
        value: m.value,
        sampleSize: m.sampleSize,
      },
    });
  }

  // 3. original_firsthand — operator firsthand-review seeds present.
  const firsthandSeeds = dataInputs?.firsthandInputs ?? [];
  if (firsthandSeeds.length > 0) {
    gaps.push({
      template: 'original_firsthand',
      reason: `${firsthandSeeds.length} operator firsthand-review seed(s) present.`,
      dataInputsRef: { source: 'firsthandInputs', seedCount: firsthandSeeds.length, seeds: firsthandSeeds },
    });
  }

  // 4. original_contrarian — operator contrarian takes present. Never originated.
  const contrarianSeeds = dataInputs?.contrarianTakes ?? [];
  if (contrarianSeeds.length > 0) {
    gaps.push({
      template: 'original_contrarian',
      reason: `${contrarianSeeds.length} operator contrarian take(s) present.`,
      dataInputsRef: { source: 'contrarianTakes', seedCount: contrarianSeeds.length, seeds: contrarianSeeds },
    });
  }

  return gaps;
}

/**
 * Originality score 0-100 for a site, from how many of the four non-commodity
 * templates are grounded + filled. Higher = the site already differs from the
 * commodity baseline. Used as the geo_seo_audits score for auditor 'content_data'.
 */
export function originalityScore(args: DetectGapsArgs): number {
  const { dataInputs, metrics, published } = args;
  const minSample = args.minSample ?? MIN_SAMPLE;

  let filled = 0;
  // Case study: seeds exist AND a page is published.
  if ((dataInputs?.caseStudyInputs.length ?? 0) > 0 && published.hasCaseStudyPage) filled += 1;
  // Data study: a qualifying metric exists AND a page is published.
  if (metrics.some((m) => m.sampleSize >= minSample) && published.hasDataStudyPage) filled += 1;
  // Firsthand + contrarian: presence of operator seeds is the signal of originality.
  if ((dataInputs?.firsthandInputs.length ?? 0) > 0) filled += 1;
  if ((dataInputs?.contrarianTakes.length ?? 0) > 0) filled += 1;

  return Math.round((filled / 4) * 100);
}
