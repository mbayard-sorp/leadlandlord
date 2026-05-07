'use server';

import { revalidatePath } from 'next/cache';
import { getSystemState, setKillSwitch } from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';

/**
 * Server actions for the kill-switch panel on /operator. Pair with
 * KillSwitchPanel.tsx which renders form state. The panel is the only UI
 * surface for flipping the switch — there's deliberately no API endpoint,
 * to keep it gated behind the operator session cookie.
 */

interface ActionResult {
  ok: boolean;
  message?: string;
}

export async function activateKillSwitch(formData: FormData): Promise<ActionResult> {
  const reason = String(formData.get('reason') ?? '').trim();
  if (!reason) {
    return { ok: false, message: 'Reason is required to activate the kill switch.' };
  }
  await setKillSwitch({ active: true, reason, activatedBy: 'operator-dashboard' });
  log.warn({ reason }, 'kill switch activated from operator dashboard');
  revalidatePath('/operator');
  return { ok: true, message: 'Kill switch activated. All agents will refuse to run.' };
}

export async function deactivateKillSwitch(): Promise<ActionResult> {
  const before = await getSystemState();
  if (!before.killSwitch) {
    return { ok: true, message: 'Kill switch already inactive.' };
  }
  await setKillSwitch({ active: false });
  log.warn(
    { wasReason: before.killSwitchReason, wasActivatedAt: before.killSwitchActivatedAt },
    'kill switch deactivated from operator dashboard',
  );
  revalidatePath('/operator');
  return { ok: true, message: 'Kill switch deactivated. Agents resume on next dispatch.' };
}
