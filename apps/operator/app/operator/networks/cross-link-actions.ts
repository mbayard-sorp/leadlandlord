'use server';

import { revalidatePath } from 'next/cache';
import { setCrossLinkPaused } from '@leadlandlord/db';

export async function toggleCrossLinkPause(paused: boolean): Promise<{ ok: true; paused: boolean }> {
  await setCrossLinkPaused(paused);
  revalidatePath('/operator/networks');
  revalidatePath('/operator/networks/[id]', 'page');
  return { ok: true, paused };
}
