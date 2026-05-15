'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getDb, agentEvents } from '@leadlandlord/db';
import { requireOperatorSession } from '@/lib/auth';
import { log } from '@leadlandlord/shared/log';

interface ActionResult {
  ok: boolean;
  message?: string;
}

export async function createWave(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const name = String(formData.get('name') ?? '').trim();
  const niche = String(formData.get('niche') ?? '').trim();
  const siteIds = formData.getAll('site_ids').map((v) => String(v)).filter(Boolean);

  if (!name) return { ok: false, message: 'name is required' };
  if (!niche) return { ok: false, message: 'niche is required' };
  if (siteIds.length < 3 || siteIds.length > 5) {
    return { ok: false, message: 'select between 3 and 5 sites' };
  }

  const db = getDb();

  await db.insert(agentEvents).values({
    agent: 'operator',
    type: 'wave.start',
    targetAgent: 'wave-launcher',
    payload: { mode: 'start', name, niche, siteIds },
  });

  log.info({ name, niche, siteIds }, 'wave-launcher start enqueued');
  revalidatePath('/operator/waves');

  // The agent writes the waves row; we redirect to the list and let the operator
  // open the detail once the cron has run. A "created" flash would require
  // more infra than we need for this phase.
  redirect('/operator/waves');
}

export async function triggerWaveProgress(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const waveId = String(formData.get('wave_id') ?? '').trim();
  if (!waveId) return { ok: false, message: 'wave_id is required' };

  const db = getDb();
  await db.insert(agentEvents).values({
    agent: 'operator',
    type: 'wave.progress',
    targetAgent: 'wave-launcher',
    payload: { mode: 'progress', waveId },
  });

  log.info({ waveId }, 'wave-launcher progress enqueued');
  revalidatePath(`/operator/waves/${waveId}`);
  return { ok: true, message: 'Re-evaluation queued. Check back after the next cron run.' };
}

export async function triggerWaveComplete(formData: FormData): Promise<ActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const waveId = String(formData.get('wave_id') ?? '').trim();
  if (!waveId) return { ok: false, message: 'wave_id is required' };

  const db = getDb();
  await db.insert(agentEvents).values({
    agent: 'operator',
    type: 'wave.complete',
    targetAgent: 'wave-launcher',
    payload: { mode: 'complete', waveId },
  });

  log.info({ waveId }, 'wave-launcher complete enqueued');
  revalidatePath(`/operator/waves/${waveId}`);
  return { ok: true, message: 'Force-complete queued.' };
}
