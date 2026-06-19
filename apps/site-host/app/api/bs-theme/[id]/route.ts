/**
 * POST /api/bs-theme/[id]
 *
 * Buyer "Save my theme" write endpoint. Persists the 4 theme-selection fields
 * (preset, layoutVariant, fontHeading, fontBody) to the buildsellSite doc and
 * sets themeLocked=true so the choice survives agent re-runs.
 *
 * Auth: HMAC-SHA256 Bearer token (or ?t= fallback). See lib/bs-preview-token.ts.
 * Write client: created inline using BS_SANITY_WRITE_TOKEN — the shared read
 * client in lib/sanity.ts is NOT given a write token.
 *
 * Server-only. Never import from a client module.
 */

import { createClient } from 'next-sanity';
import { type NextRequest, NextResponse } from 'next/server';
import { verifyBsPreviewToken } from '@/lib/bs-preview-token';
import { sanity } from '@/lib/sanity';
import { buildsellSiteDocId } from '@leadlandlord/sanity-schema/ids';
import { BUILDSELL_PRESETS } from '@leadlandlord/sanity-schema/presets';
import { BUILDSELL_FONT_VAR_MAP } from '@/lib/buildsell-fonts';

const VALID_PRESET_NAMES = new Set(BUILDSELL_PRESETS.map((p) => p.name));
const VALID_LAYOUT_VARIANTS = new Set(['split', 'bold', 'trust']);
const VALID_FONTS = new Set(Object.keys(BUILDSELL_FONT_VAR_MAP));

const REQUIRED_KEYS = ['preset', 'layoutVariant', 'fontHeading', 'fontBody'] as const;
type ThemeBody = Record<(typeof REQUIRED_KEYS)[number], string>;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // --- 1. Auth ---
  const authHeader = req.headers.get('authorization') ?? '';
  const bearerToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  const queryToken = req.nextUrl.searchParams.get('t');
  const token = bearerToken ?? queryToken;

  if (!verifyBsPreviewToken(id, token)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // --- 2. Parse body ---
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return json({ error: 'Body must be a JSON object' }, 400);
  }

  const bodyObj = rawBody as Record<string, unknown>;

  // Reject unknown keys
  const incomingKeys = Object.keys(bodyObj);
  const requiredSet = new Set<string>(REQUIRED_KEYS);
  for (const k of incomingKeys) {
    if (!requiredSet.has(k)) {
      return json({ error: `Unknown key: ${k}` }, 400);
    }
  }

  // Require all 4 keys
  for (const k of REQUIRED_KEYS) {
    if (!(k in bodyObj) || typeof bodyObj[k] !== 'string') {
      return json({ error: `Missing or invalid key: ${k}` }, 400);
    }
  }

  const body = bodyObj as ThemeBody;

  // --- 3. Validate values ---
  if (!VALID_PRESET_NAMES.has(body.preset)) {
    return json({ error: `Unknown preset: ${body.preset}` }, 400);
  }
  if (!VALID_LAYOUT_VARIANTS.has(body.layoutVariant)) {
    return json({ error: `Unknown layoutVariant: ${body.layoutVariant}` }, 400);
  }
  if (!VALID_FONTS.has(body.fontHeading)) {
    return json({ error: `Unknown fontHeading: ${body.fontHeading}` }, 400);
  }
  if (!VALID_FONTS.has(body.fontBody)) {
    return json({ error: `Unknown fontBody: ${body.fontBody}` }, 400);
  }

  // --- 4. Fetch the doc ---
  // Use a fresh (non-CDN) read so the draftMode / themeLocked guards below
  // can't act on a stale CDN copy of the doc.
  const docId = buildsellSiteDocId(id);
  const doc = await sanity.withConfig({ useCdn: false }).fetch<{
    _type: string;
    draftMode?: boolean | null;
    themeLocked?: boolean | null;
    theme?: {
      preset?: string | null;
      layoutVariant?: string | null;
      fontHeading?: string | null;
      fontBody?: string | null;
    } | null;
  } | null>(
    `*[_id == $docId][0]{ _type, draftMode, themeLocked, "theme": { "preset": theme.preset, "layoutVariant": theme.layoutVariant, "fontHeading": theme.fontHeading, "fontBody": theme.fontBody } }`,
    { docId },
  );

  if (!doc || doc._type !== 'buildsellSite') {
    return json({ error: 'Site not found' }, 404);
  }

  // --- 5. draftMode guard ---
  if (doc.draftMode !== true) {
    return json({ error: 'Theme editing is only available on draft sites' }, 403);
  }

  // --- 6. themeLocked ---
  if (doc.themeLocked === true) {
    const stored = doc.theme ?? {};
    const matches =
      stored.preset === body.preset &&
      stored.layoutVariant === body.layoutVariant &&
      stored.fontHeading === body.fontHeading &&
      stored.fontBody === body.fontBody;

    if (matches) {
      // Idempotent — already saved with identical values
      return json({ ok: true, theme: body }, 200);
    }
    return json({ error: 'Theme already locked by buyer.' }, 409);
  }

  // --- 7. Patch with a scoped write client ---
  const writeToken = process.env.BS_SANITY_WRITE_TOKEN;
  if (!writeToken) {
    // Surface config gap clearly rather than silently discarding the write.
    return json({ error: 'Write token not configured' }, 500);
  }

  // Re-use projectId / dataset / apiVersion from the shared read client config
  // but supply the write token and disable CDN.
  const { config: readConfig } = sanity;
  const writeClient = createClient({
    projectId: readConfig().projectId,
    dataset: readConfig().dataset,
    apiVersion: readConfig().apiVersion ?? '2024-10-01',
    token: writeToken,
    useCdn: false,
  });

  await writeClient
    .patch(docId)
    .set({
      'theme.preset': body.preset,
      'theme.layoutVariant': body.layoutVariant,
      'theme.fontHeading': body.fontHeading,
      'theme.fontBody': body.fontBody,
      themeLocked: true,
    })
    .commit({ visibility: 'sync' });

  return json({ ok: true, theme: body }, 200);
}
