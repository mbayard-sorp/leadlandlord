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
