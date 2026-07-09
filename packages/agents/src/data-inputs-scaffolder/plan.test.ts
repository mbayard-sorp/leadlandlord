import { describe, it, expect } from 'vitest';
import {
  planFill,
  planIsEmpty,
  buildBaselineFacts,
  buildExpertiseProfile,
  tagIllustrative,
  type ExistingInputsView,
} from './plan';

const FULL_ROW: ExistingInputsView = {
  caseStudyInputs: [{ problem: 'p', solution: 's', outcome: 'o' }],
  firsthandInputs: [{ subject: 's', experience: 'e', verdict: 'v' }],
  contrarianTakes: [{ claim: 'c', reasoning: 'r', evidence: 'e' }],
  proprietaryFacts: { hours: 'Mon-Fri 8-5' },
  expertiseProfile: { authorName: 'Jane Doe', authorTitle: 'Owner' },
};

describe('planFill', () => {
  it('plans everything when no row exists', () => {
    const plan = planFill(null);
    expect(plan).toEqual({
      needCaseStudies: true,
      needFirsthand: true,
      needFacts: true,
      needExpertise: true,
    });
  });

  it('plans NOTHING for a fully operator-populated row — operator data always wins', () => {
    const plan = planFill(FULL_ROW);
    expect(planIsEmpty(plan)).toBe(true);
  });

  it('plans only the empty fields', () => {
    const plan = planFill({
      ...FULL_ROW,
      caseStudyInputs: [],
      expertiseProfile: null,
    });
    expect(plan.needCaseStudies).toBe(true);
    expect(plan.needExpertise).toBe(true);
    expect(plan.needFirsthand).toBe(false);
    expect(plan.needFacts).toBe(false);
  });

  it('treats an expertise profile without an authorName as empty', () => {
    const plan = planFill({ ...FULL_ROW, expertiseProfile: { authorName: '   ' } });
    expect(plan.needExpertise).toBe(true);
  });

  it('never plans contrarianTakes, even when empty', () => {
    const plan = planFill({ ...FULL_ROW, contrarianTakes: [] });
    // FillPlan has no contrarian field at all — the type is the contract.
    expect(Object.keys(plan).sort()).toEqual([
      'needCaseStudies',
      'needExpertise',
      'needFacts',
      'needFirsthand',
    ]);
  });
});

describe('buildBaselineFacts', () => {
  it('derives facts only from data we hold', () => {
    const facts = buildBaselineFacts({ niche: 'tree removal', city: 'Tucson', state: 'AZ' });
    expect(facts.serviceArea).toBe('Tucson, AZ');
    expect(facts.trade).toBe('tree removal');
    expect(facts.operatedBy).toBeUndefined();
    // No invented business claims.
    expect(facts.hours).toBeUndefined();
    expect(facts.certifications).toBeUndefined();
    expect(facts.guarantees).toBeUndefined();
  });

  it('includes operatedBy only when a live tenant exists', () => {
    const facts = buildBaselineFacts({
      niche: 'tree removal',
      city: 'Tucson',
      state: 'AZ',
      tenantBusinessName: 'Desert Tree Pros',
    });
    expect(facts.operatedBy).toBe('Desert Tree Pros');
  });
});

describe('buildExpertiseProfile', () => {
  it('creates team-level attribution — never an invented named person', () => {
    const profile = buildExpertiseProfile({ niche: 'tree removal', city: 'tucson', state: 'AZ' });
    expect(profile.authorName).toBe('The Tucson Tree Removal Team');
    expect(profile.authorTitle).toContain('serving tucson, AZ');
    // No invented bio / credentials.
    expect(profile.authorBio).toBeUndefined();
  });

  it('uses the tenant business name when present', () => {
    const profile = buildExpertiseProfile({
      niche: 'tree removal',
      city: 'Tucson',
      state: 'AZ',
      tenantBusinessName: 'Desert Tree Pros',
    });
    expect(profile.authorName).toBe('The Desert Tree Pros Team');
  });
});

describe('tagIllustrative', () => {
  it('tags every generated seed as an illustrative composite', () => {
    const tagged = tagIllustrative([{ problem: 'p' }, { subject: 's' }]);
    for (const seed of tagged) {
      expect(seed.illustrative).toBe(true);
      expect(seed.source).toBe('data-inputs-scaffolder');
    }
  });
});
