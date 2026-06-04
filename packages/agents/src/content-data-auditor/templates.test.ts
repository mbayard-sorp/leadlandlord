import { describe, it, expect } from 'vitest';
import {
  detectGaps,
  originalityScore,
  MIN_SAMPLE,
  type DataInputsView,
  type MetricView,
  type PublishedView,
} from './templates';

const EMPTY_INPUTS: DataInputsView = {
  caseStudyInputs: [],
  firsthandInputs: [],
  contrarianTakes: [],
};
const NO_PAGES: PublishedView = { hasCaseStudyPage: false, hasDataStudyPage: false };

describe('detectGaps — operator-seeded templates', () => {
  it('raises case-study gap when seeds present and no page', () => {
    const gaps = detectGaps({
      dataInputs: { ...EMPTY_INPUTS, caseStudyInputs: [{ problem: 'x', outcome: 'y' }] },
      metrics: [],
      published: NO_PAGES,
    });
    expect(gaps.map((g) => g.template)).toContain('original_case_study');
  });

  it('suppresses case-study gap when a page already exists', () => {
    const gaps = detectGaps({
      dataInputs: { ...EMPTY_INPUTS, caseStudyInputs: [{ problem: 'x' }] },
      metrics: [],
      published: { ...NO_PAGES, hasCaseStudyPage: true },
    });
    expect(gaps.map((g) => g.template)).not.toContain('original_case_study');
  });

  it('raises firsthand + contrarian gaps from seeds', () => {
    const gaps = detectGaps({
      dataInputs: {
        caseStudyInputs: [],
        firsthandInputs: [{ subject: 'tool', verdict: 'good' }],
        contrarianTakes: [{ claim: 'c', reasoning: 'r' }],
      },
      metrics: [],
      published: NO_PAGES,
    });
    const templates = gaps.map((g) => g.template);
    expect(templates).toContain('original_firsthand');
    expect(templates).toContain('original_contrarian');
  });

  it('raises no operator-seeded gaps when inputs are empty', () => {
    const gaps = detectGaps({ dataInputs: EMPTY_INPUTS, metrics: [], published: NO_PAGES });
    expect(gaps).toHaveLength(0);
  });
});

describe('detectGaps — data-study sampleSize gating + anti-fabrication', () => {
  const metricBelow: MetricView = {
    metricKind: 'call_volume',
    value: { total: 12, perDay: 0.13 },
    sampleSize: MIN_SAMPLE - 1,
  };
  const metricAbove: MetricView = {
    metricKind: 'job_type_mix',
    value: { counts: { won: 40 }, total: 40 },
    sampleSize: 40,
  };

  it('does NOT raise a data-study gap below the sample threshold', () => {
    const gaps = detectGaps({ dataInputs: EMPTY_INPUTS, metrics: [metricBelow], published: NO_PAGES });
    expect(gaps.map((g) => g.template)).not.toContain('original_data_study');
  });

  it('raises a data-study gap at/above the threshold', () => {
    const gaps = detectGaps({ dataInputs: EMPTY_INPUTS, metrics: [metricAbove], published: NO_PAGES });
    expect(gaps.map((g) => g.template)).toContain('original_data_study');
  });

  it('carries ONLY verbatim metric numbers in dataInputsRef — no fabricated stats', () => {
    const gaps = detectGaps({ dataInputs: EMPTY_INPUTS, metrics: [metricAbove], published: NO_PAGES });
    const dataStudy = gaps.find((g) => g.template === 'original_data_study')!;
    // The ref value must be reference-equal to the source metric value: nothing
    // synthesized, nothing rounded, nothing added.
    expect(dataStudy.dataInputsRef.value).toBe(metricAbove.value);
    expect(dataStudy.dataInputsRef.sampleSize).toBe(40);
    expect(dataStudy.dataInputsRef.metricKind).toBe('job_type_mix');
    // No numeric key should appear in the ref that isn't sourced from the metric.
    expect(Object.keys(dataStudy.dataInputsRef).sort()).toEqual(
      ['metricKind', 'sampleSize', 'source', 'value'].sort(),
    );
  });

  it('picks the highest-sampleSize qualifying metric', () => {
    const low: MetricView = { metricKind: 'a', value: { total: 30 }, sampleSize: 31 };
    const high: MetricView = { metricKind: 'b', value: { total: 99 }, sampleSize: 99 };
    const gaps = detectGaps({ dataInputs: EMPTY_INPUTS, metrics: [low, high], published: NO_PAGES });
    const dataStudy = gaps.find((g) => g.template === 'original_data_study')!;
    expect(dataStudy.dataInputsRef.metricKind).toBe('b');
  });

  it('suppresses data-study gap when a page already exists', () => {
    const gaps = detectGaps({
      dataInputs: EMPTY_INPUTS,
      metrics: [metricAbove],
      published: { ...NO_PAGES, hasDataStudyPage: true },
    });
    expect(gaps.map((g) => g.template)).not.toContain('original_data_study');
  });
});

describe('originalityScore', () => {
  it('is 0 when nothing is grounded or filled', () => {
    expect(originalityScore({ dataInputs: EMPTY_INPUTS, metrics: [], published: NO_PAGES })).toBe(0);
  });

  it('is 100 when all four templates are grounded + filled', () => {
    const score = originalityScore({
      dataInputs: {
        caseStudyInputs: [{ problem: 'x' }],
        firsthandInputs: [{ subject: 't' }],
        contrarianTakes: [{ claim: 'c' }],
      },
      metrics: [{ metricKind: 'm', value: { total: 50 }, sampleSize: 50 }],
      published: { hasCaseStudyPage: true, hasDataStudyPage: true },
    });
    expect(score).toBe(100);
  });

  it('counts firsthand/contrarian seeds even without published pages', () => {
    const score = originalityScore({
      dataInputs: { caseStudyInputs: [], firsthandInputs: [{}], contrarianTakes: [{}] },
      metrics: [],
      published: NO_PAGES,
    });
    expect(score).toBe(50);
  });
});
