'use server';

/**
 * Server actions for the Operator Control panel — flips operator targets,
 * autonomy mode, and the master operatorEnabled switch on the singleton
 * system_state row. Pair with apps/operator/app/operator/control/page.tsx.
 *
 * Only writable from the operator dashboard (gated behind the operator
 * session cookie) — there is deliberately no public API endpoint for
 * autonomy controls.
 */

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, systemState } from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';

interface ActionResult {
  ok: boolean;
  message?: string;
}

const VALID_MODES = new Set(['manual', 'supervised', 'autonomous']);

function num(v: FormDataEntryValue | null): number | null {
  if (v == null) return null;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
}

function int(v: FormDataEntryValue | null): number | null {
  if (v == null) return null;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function bool(v: FormDataEntryValue | null): boolean {
  return v === 'on' || v === 'true' || v === '1';
}

export async function updateOperatorTargets(formData: FormData): Promise<ActionResult> {
  const targetMrr = num(formData.get('targetMrrUsd'));
  const targetSites = int(formData.get('targetActiveSites'));
  const targetMargin = num(formData.get('targetMonthlyMargin'));
  const autoApproveDomainBudget = num(formData.get('autoApproveDomainBudgetUsd'));
  const autoApproveNiches = bool(formData.get('autoApproveNiches'));

  if (
    targetMrr == null ||
    targetSites == null ||
    targetMargin == null ||
    autoApproveDomainBudget == null
  ) {
    return { ok: false, message: 'All numeric fields are required.' };
  }
  if (targetMrr < 0 || targetSites < 0 || autoApproveDomainBudget < 0) {
    return { ok: false, message: 'Negative values are not allowed.' };
  }
  if (targetMargin < -1 || targetMargin > 1) {
    return { ok: false, message: 'Target margin must be a fraction between -1 and 1.' };
  }

  const db = getDb();
  await db
    .update(systemState)
    .set({
      targetMrrUsd: targetMrr.toFixed(2),
      targetActiveSites: targetSites,
      targetMonthlyMargin: targetMargin.toFixed(4),
      autoApproveDomainBudgetUsd: autoApproveDomainBudget.toFixed(2),
      autoApproveNiches,
      updatedAt: new Date(),
    })
    .where(eq(systemState.id, 'global'));

  log.info(
    { targetMrr, targetSites, targetMargin, autoApproveDomainBudget, autoApproveNiches },
    'operator targets updated from dashboard',
  );
  revalidatePath('/operator/control');
  return { ok: true, message: 'Targets saved.' };
}

export async function updateOperatorMode(formData: FormData): Promise<ActionResult> {
  const mode = String(formData.get('operatorMode') ?? '');
  if (!VALID_MODES.has(mode)) {
    return { ok: false, message: 'Invalid mode.' };
  }
  // Defense-in-depth: refuse to flip directly to autonomous without
  // operatorEnabled already being true. Forces an explicit two-step opt-in.
  const db = getDb();
  if (mode === 'autonomous') {
    const [row] = await db.select().from(systemState).where(eq(systemState.id, 'global')).limit(1);
    if (!row?.operatorEnabled) {
      return {
        ok: false,
        message: 'Enable the operator first, then switch to autonomous.',
      };
    }
  }
  await db
    .update(systemState)
    .set({ operatorMode: mode, updatedAt: new Date() })
    .where(eq(systemState.id, 'global'));
  log.warn({ mode }, 'operator mode changed from dashboard');
  revalidatePath('/operator/control');
  return { ok: true, message: `Mode set to ${mode}.` };
}

/**
 * Optional numeric: blank/whitespace → null (reset to the hardcoded default),
 * otherwise a finite number. Returns `undefined` to signal a parse error.
 */
function optNum(v: FormDataEntryValue | null): number | null | undefined {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Task B: operator-tunable niche-scoring priors on system_state. A blank field
 * stores NULL, which the validate action reads as "use the agents-package
 * default" (geoSharePrior 0.15, cpc ceiling 12, lead-price ceiling 100).
 */
export async function updateScoringPriors(formData: FormData): Promise<ActionResult> {
  const geo = optNum(formData.get('geoSharePrior'));
  const cpc = optNum(formData.get('rentabilityCpcCeiling'));
  const lead = optNum(formData.get('rentabilityLeadPriceCeiling'));

  if (geo === undefined || cpc === undefined || lead === undefined) {
    return { ok: false, message: 'Values must be numbers (or blank to reset to default).' };
  }
  if (geo != null && (geo <= 0 || geo > 1)) {
    return { ok: false, message: 'Geo-share prior must be a fraction in (0, 1].' };
  }
  if (cpc != null && cpc <= 0) {
    return { ok: false, message: 'CPC ceiling must be greater than 0.' };
  }
  if (lead != null && lead <= 0) {
    return { ok: false, message: 'Lead-price ceiling must be greater than 0.' };
  }

  const db = getDb();
  await db
    .update(systemState)
    .set({
      geoSharePrior: geo == null ? null : geo.toFixed(3),
      rentabilityCpcCeiling: cpc == null ? null : cpc.toFixed(2),
      rentabilityLeadPriceCeiling: lead == null ? null : lead.toFixed(2),
      updatedAt: new Date(),
    })
    .where(eq(systemState.id, 'global'));

  log.info({ geo, cpc, lead }, 'niche-scoring priors updated from dashboard');
  revalidatePath('/operator/control');
  return { ok: true, message: 'Scoring priors saved. Applies to the next niche validation.' };
}

/**
 * Scout geographic-targeting and refinement knobs (ADR 0022). All nullable —
 * blank stores NULL, which the scout reads as "use the code default".
 *
 * Blend strengths (0–1): 0 = inert (default); suggested starting values 0.3–0.5.
 * Per-state cap (int > 0): NULL = no cap (current behavior).
 * Refine top-K (int >= 0): 0 or NULL = Stage-3 disabled (default).
 * Refine budget (USD): NULL = code default ($3.00).
 * Refine measure volume (bool): NULL = false (code default).
 */
export async function updateScoutGeoKnobs(formData: FormData): Promise<ActionResult> {
  const compBlend = optNum(formData.get('scoutGeoCompBlend'));
  const demandBlend = optNum(formData.get('scoutGeoDemandBlend'));
  const perStateCap = optNum(formData.get('scoutPerStateCap'));
  const refineTopK = optNum(formData.get('scoutRefineTopK'));
  const refineBudget = optNum(formData.get('scoutRefineBudgetUsd'));
  const refineMeasureVolumeRaw = formData.get('scoutRefineMeasureVolume');

  if (
    compBlend === undefined ||
    demandBlend === undefined ||
    perStateCap === undefined ||
    refineTopK === undefined ||
    refineBudget === undefined
  ) {
    return { ok: false, message: 'Values must be numbers (or blank to reset to default).' };
  }
  if (compBlend != null && (compBlend < 0 || compBlend > 1)) {
    return { ok: false, message: 'Geo comp blend must be between 0 and 1.' };
  }
  if (demandBlend != null && (demandBlend < 0 || demandBlend > 1)) {
    return { ok: false, message: 'Geo demand blend must be between 0 and 1.' };
  }
  if (perStateCap != null && (!Number.isInteger(perStateCap) || perStateCap < 1)) {
    return { ok: false, message: 'Per-state cap must be a positive integer.' };
  }
  if (refineTopK != null && (!Number.isInteger(refineTopK) || refineTopK < 0)) {
    return { ok: false, message: 'Refine top-K must be a non-negative integer.' };
  }
  if (refineBudget != null && refineBudget < 0) {
    return { ok: false, message: 'Refine budget must be >= 0.' };
  }

  // Boolean: checkbox present = true, absent = null (fall back to code default false).
  const refineMeasureVolume: boolean | null =
    refineMeasureVolumeRaw === 'on' || refineMeasureVolumeRaw === 'true'
      ? true
      : refineMeasureVolumeRaw === ''
        ? false
        : null;

  const db = getDb();
  await db
    .update(systemState)
    .set({
      scoutGeoCompBlend: compBlend == null ? null : compBlend.toFixed(3),
      scoutGeoDemandBlend: demandBlend == null ? null : demandBlend.toFixed(3),
      scoutPerStateCap: perStateCap == null ? null : Math.round(perStateCap),
      scoutRefineTopK: refineTopK == null ? null : Math.round(refineTopK),
      scoutRefineBudgetUsd: refineBudget == null ? null : refineBudget.toFixed(2),
      scoutRefineMeasureVolume: refineMeasureVolume,
      updatedAt: new Date(),
    })
    .where(eq(systemState.id, 'global'));

  log.info(
    { compBlend, demandBlend, perStateCap, refineTopK, refineBudget, refineMeasureVolume },
    'scout geo-targeting knobs updated from dashboard',
  );
  revalidatePath('/operator/control');
  return { ok: true, message: 'Scout geo-targeting knobs saved. Applies to the next scout run.' };
}

/**
 * Set the operator dashboard display time zone (migration 0047). Validated
 * against the runtime's IANA zone list so a malformed value can never reach the
 * formatter (an invalid `timeZone` makes Intl.DateTimeFormat throw). Display
 * only — does not change cron execution, which Vercel always runs in UTC.
 */
export async function updateOperatorTimeZone(formData: FormData): Promise<ActionResult> {
  const tz = String(formData.get('operatorTimeZone') ?? '').trim();
  if (!tz) {
    return { ok: false, message: 'Time zone is required.' };
  }
  const supported = Intl.supportedValuesOf('timeZone');
  if (tz !== 'UTC' && !supported.includes(tz)) {
    return { ok: false, message: `Unknown time zone "${tz}".` };
  }
  const db = getDb();
  await db
    .update(systemState)
    .set({ operatorTimeZone: tz, updatedAt: new Date() })
    .where(eq(systemState.id, 'global'));
  log.info({ tz }, 'operator display time zone updated from dashboard');
  revalidatePath('/operator', 'layout');
  return { ok: true, message: `Time zone set to ${tz}.` };
}

export async function setOperatorEnabled(formData: FormData): Promise<ActionResult> {
  const enabled = bool(formData.get('enabled'));
  const db = getDb();
  await db
    .update(systemState)
    .set({ operatorEnabled: enabled, updatedAt: new Date() })
    .where(eq(systemState.id, 'global'));
  log.warn({ enabled }, 'operator enabled flag flipped from dashboard');
  revalidatePath('/operator/control');
  return {
    ok: true,
    message: enabled
      ? 'Operator enabled. It will run on the next cron tick.'
      : 'Operator disabled. Cron ticks will short-circuit to no_op.',
  };
}
