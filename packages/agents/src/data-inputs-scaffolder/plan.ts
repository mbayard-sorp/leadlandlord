/**
 * Pure fill-planning for the data-inputs-scaffolder.
 *
 * The scaffolder auto-populates EMPTY siteOriginalDataInputs fields so the
 * content-data-auditor → local-content-writer pipeline has grounded inputs
 * without the operator hand-typing JSON per site. Honesty contract, enforced
 * here and in the agent:
 *
 *  - NEVER overwrites a non-empty field — operator-entered data always wins.
 *  - NEVER fills contrarianTakes — a contrarian claim needs a human willing to
 *    stand behind it (see the schema comment: "Never auto-generated").
 *  - Generated case-study / firsthand seeds are tagged `illustrative: true` +
 *    `source: 'data-inputs-scaffolder'`; the writer is forced into
 *    composite/illustrative framing (never "a real verified client").
 *  - proprietaryFacts only gets facts derived from data we actually hold
 *    (service area, trade, live tenant business name) — no invented hours,
 *    certifications, or guarantees.
 *  - expertiseProfile is team-level attribution only — never an invented named
 *    person and never invented credentials.
 */

export interface ExistingInputsView {
  caseStudyInputs: Array<Record<string, unknown>>;
  firsthandInputs: Array<Record<string, unknown>>;
  contrarianTakes: Array<Record<string, unknown>>;
  proprietaryFacts: Record<string, unknown>;
  expertiseProfile: Record<string, unknown> | null;
}

export interface FillPlan {
  needCaseStudies: boolean;
  needFirsthand: boolean;
  needFacts: boolean;
  needExpertise: boolean;
}

/** Which empty fields the scaffolder may fill. contrarianTakes is never planned. */
export function planFill(existing: ExistingInputsView | null): FillPlan {
  if (!existing) {
    return { needCaseStudies: true, needFirsthand: true, needFacts: true, needExpertise: true };
  }
  const hasExpertiseName =
    !!existing.expertiseProfile &&
    typeof existing.expertiseProfile.authorName === 'string' &&
    existing.expertiseProfile.authorName.trim() !== '';
  return {
    needCaseStudies: existing.caseStudyInputs.length === 0,
    needFirsthand: existing.firsthandInputs.length === 0,
    needFacts: Object.keys(existing.proprietaryFacts).length === 0,
    needExpertise: !hasExpertiseName,
  };
}

export function planIsEmpty(plan: FillPlan): boolean {
  return !plan.needCaseStudies && !plan.needFirsthand && !plan.needFacts && !plan.needExpertise;
}

export interface SiteFactsInput {
  niche: string;
  city: string;
  state: string;
  /** Business name of a live (non-churned) tenant, when one exists. */
  tenantBusinessName?: string | null;
}

/**
 * DB-derived vouched facts only. Deliberately small: everything here is true
 * from our own records, nothing is a marketing claim.
 */
export function buildBaselineFacts(input: SiteFactsInput): Record<string, unknown> {
  return {
    serviceArea: `${input.city}, ${input.state}`,
    trade: input.niche,
    ...(input.tenantBusinessName ? { operatedBy: input.tenantBusinessName } : {}),
    source: 'data-inputs-scaffolder',
  };
}

/**
 * Team-level E-E-A-T attribution. No invented person, no invented credentials —
 * just honest "the team behind this site" attribution that the writer renders
 * as a byline + Organization author in JSON-LD.
 */
export function buildExpertiseProfile(input: SiteFactsInput): Record<string, unknown> {
  const authorName = input.tenantBusinessName
    ? `The ${input.tenantBusinessName} Team`
    : `The ${titleCase(input.city)} ${titleCase(input.niche)} Team`;
  return {
    authorName,
    authorTitle: `${titleCase(input.niche)} professionals serving ${input.city}, ${input.state}`,
    source: 'data-inputs-scaffolder',
  };
}

/** Tag LLM-generated seeds so downstream consumers know they are composites. */
export function tagIllustrative(
  seeds: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return seeds.map((s) => ({ ...s, illustrative: true, source: 'data-inputs-scaffolder' }));
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
