'use server';

import { revalidatePath } from 'next/cache';
import { setCrossLinkPaused } from '@leadlandlord/db';
import { bustSiteHostTags } from '@/lib/site-host-revalidate';

export async function toggleCrossLinkPause(paused: boolean): Promise<{ ok: true; paused: boolean }> {
  await setCrossLinkPaused(paused);
  // site-host caches the kill-switch read for 5 min (Track C); bust so the
  // pause takes effect on the next page view instead of the next window.
  await bustSiteHostTags(['system-state', 'cross-links']);
  revalidatePath('/operator/networks');
  revalidatePath('/operator/networks/[id]', 'page');
  return { ok: true, paused };
}
