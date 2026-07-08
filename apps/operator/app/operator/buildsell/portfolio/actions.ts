'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, buildsellSites } from '@leadlandlord/db';
import { createWriteClient } from '@leadlandlord/integrations/sanity';
import { buildsellSiteDocId } from '@leadlandlord/sanity-schema/ids';
import { BUILDSELL_PRESET_NAMES } from '@leadlandlord/sanity-schema/presets';
import { requireOperatorSession } from '@/lib/auth';
import { log } from '@leadlandlord/shared/log';

export interface PortfolioActionResult {
  ok: boolean;
  message?: string;
}

// These actions patch Postgres and/or Sanity directly. None dispatch an agent,
// so — unlike the rebuild/revise actions in ../actions.ts — they do NOT need a
// killSwitch gate. If a future version makes any of them trigger a build, add
// the sys.killSwitch check at that point.

/**
 * Correct a Build & Sell site's asking price out-of-band. Postgres only —
 * price is not a render field. Does NOT re-send the invoice or touch the
 * invoice number / payment link (that's what sendInvoice is for).
 */
export async function updateBuildSellPrice(
  formData: FormData,
): Promise<PortfolioActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const siteId = String(formData.get('site_id') ?? '').trim();
  const rawPrice = String(formData.get('price_usd') ?? '').trim();
  if (!siteId) return { ok: false, message: 'Missing site id.' };

  let priceUsd: string | null = null;
  if (rawPrice) {
    const n = Number(rawPrice);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, message: 'Enter a non-negative dollar amount.' };
    }
    priceUsd = n.toFixed(2);
  }

  const db = getDb();
  const [existing] = await db
    .select({ id: buildsellSites.id })
    .from(buildsellSites)
    .where(eq(buildsellSites.id, siteId))
    .limit(1);
  if (!existing) return { ok: false, message: 'Site not found.' };

  await db
    .update(buildsellSites)
    .set({ priceUsd, updatedAt: new Date() })
    .where(eq(buildsellSites.id, siteId));

  revalidatePath('/operator/buildsell/portfolio');
  revalidatePath(`/operator/buildsell/${siteId}`);
  return {
    ok: true,
    message: priceUsd
      ? `Price set to $${priceUsd}. Invoice not re-sent.`
      : 'Price cleared. Invoice not re-sent.',
  };
}

/**
 * Toggle a site's public search visibility. Sanity only — flips both
 * draftMode + robotsDisallow together (the two layers goLiveSite clears at
 * go-live). Does NOT change the Postgres `status`: a hidden live site is still
 * status='live'. Refuses drafts, which are hidden by design.
 */
export async function setBuildSellVisibility(
  formData: FormData,
): Promise<PortfolioActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const siteId = String(formData.get('site_id') ?? '').trim();
  const visible = String(formData.get('visible') ?? '') === 'true';
  if (!siteId) return { ok: false, message: 'Missing site id.' };

  const db = getDb();
  const [existing] = await db
    .select({ id: buildsellSites.id, status: buildsellSites.status })
    .from(buildsellSites)
    .where(eq(buildsellSites.id, siteId))
    .limit(1);
  if (!existing) return { ok: false, message: 'Site not found.' };
  if (existing.status === 'draft') {
    return {
      ok: false,
      message: 'Draft sites are hidden by design — send an invoice / mark paid to go live.',
    };
  }

  const docId = buildsellSiteDocId(siteId);
  try {
    await createWriteClient()
      .patch(docId)
      .set({ draftMode: !visible, robotsDisallow: !visible })
      .commit({ visibility: 'sync' });
  } catch (err) {
    log.error({ siteId, docId, err }, 'setBuildSellVisibility: Sanity patch failed');
    return {
      ok: false,
      message: `Sanity patch failed (visibility unchanged): ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  revalidatePath('/operator/buildsell/portfolio');
  revalidatePath(`/operator/buildsell/${siteId}`);
  return {
    ok: true,
    message: visible
      ? 'Site is now visible to search. Public site updates on its next render.'
      : 'Site is now hidden from search — re-enable to restore indexing. Public site updates on its next render.',
  };
}

/**
 * Restyle a site by switching its named palette preset. Sanity `theme.preset`
 * is authoritative for render colors, so this patches Sanity and mirrors the
 * name into the Postgres `themePreset` column (the dashboard's display source).
 *
 * No rebuild is triggered: colors resolve from the preset name at render time,
 * and rebuilding a live site risks clobbering draftMode/robotsDisallow. Refuses
 * theme-locked (live/sold) sites — unlock via the detail page first.
 */
export async function updateBuildSellThemePreset(
  formData: FormData,
): Promise<PortfolioActionResult> {
  try { await requireOperatorSession(); } catch { return { ok: false, message: 'unauthorized' }; }

  const siteId = String(formData.get('site_id') ?? '').trim();
  const preset = String(formData.get('preset') ?? '').trim();
  if (!siteId) return { ok: false, message: 'Missing site id.' };
  if (!BUILDSELL_PRESET_NAMES.includes(preset)) {
    return { ok: false, message: 'Unknown preset.' };
  }

  const db = getDb();
  const [existing] = await db
    .select({ id: buildsellSites.id })
    .from(buildsellSites)
    .where(eq(buildsellSites.id, siteId))
    .limit(1);
  if (!existing) return { ok: false, message: 'Site not found.' };

  const docId = buildsellSiteDocId(siteId);
  const client = createWriteClient();

  // Read-before-write: the lock is the real safety net (the client also
  // disables the dropdown, but that's just UX).
  let themeLocked: boolean | null = null;
  try {
    const snap = await client.fetch<{ themeLocked?: boolean } | null>(
      `*[_id==$id][0]{ themeLocked }`,
      { id: docId },
    );
    themeLocked = snap?.themeLocked ?? null;
  } catch (err) {
    log.error({ siteId, docId, err }, 'updateBuildSellThemePreset: lock read failed');
    return { ok: false, message: 'Could not read theme lock state — try again.' };
  }
  if (themeLocked === true) {
    return {
      ok: false,
      message: 'Theme is locked on this live site. Unlock via the detail page before restyling.',
    };
  }

  try {
    await client.patch(docId).set({ 'theme.preset': preset }).commit({ visibility: 'sync' });
  } catch (err) {
    log.error({ siteId, docId, err }, 'updateBuildSellThemePreset: Sanity patch failed');
    return {
      ok: false,
      message: `Sanity patch failed (preset unchanged): ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Keep the Postgres display column in sync (source-of-record for the table).
  await db
    .update(buildsellSites)
    .set({ themePreset: preset, updatedAt: new Date() })
    .where(eq(buildsellSites.id, siteId));

  revalidatePath('/operator/buildsell/portfolio');
  revalidatePath(`/operator/buildsell/${siteId}`);
  return { ok: true, message: `Theme set to "${preset}". Live site restyles on next render.` };
}
