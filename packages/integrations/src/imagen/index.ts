import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';

const AI_GATEWAY_BASE = 'https://ai-gateway.vercel.sh/v1';

/**
 * Image generation via Vercel AI Gateway.
 *
 * Auth:
 *   - AI_GATEWAY_API_KEY (preferred for local dev) — get from
 *     https://vercel.com/dashboard/ai-gateway → "Create API key".
 *   - On Vercel deployments, OIDC token is auto-injected; for now we still
 *     require AI_GATEWAY_API_KEY since Site Builder runs locally during dry-run.
 *
 * Falls back to a no-op if the key is missing — Site Builder treats a null
 * return as "no hero image" and the variant components render their
 * placeholder backgrounds.
 *
 * Model selection: env var IMAGEN_MODEL, default `google/imagen-3-fast`.
 * Imagen costs ~$0.02–$0.04 per image at the time of writing — well under
 * the per-site budget. One hero image per site.
 */
export interface GenerateImageArgs {
  prompt: string;
  aspectRatio?: '16:9' | '4:3' | '1:1' | '3:2';
  /** Where to save the result. The function downloads the bytes itself. */
  outputPath: string;
  /** Negative prompt — describe what NOT to put in the image. */
  negativePrompt?: string;
}

export interface GenerateImageResult {
  /** Absolute path the image was written to. */
  path: string;
  /** Public-relative path (e.g., `/hero.jpg`) — useful for the bundle URL. */
  publicPath: string;
  /** Bytes written. */
  size: number;
  model: string;
  costUsd?: number;
}

export async function generateHeroImage(args: GenerateImageArgs): Promise<GenerateImageResult | null> {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) {
    log.warn('AI_GATEWAY_API_KEY not set — skipping hero image generation');
    return null;
  }

  const model = process.env.IMAGEN_MODEL ?? 'google/imagen-3-fast';
  const aspectRatio = args.aspectRatio ?? '16:9';
  const size = sizeForAspect(aspectRatio);

  const body = {
    model,
    prompt: enrichPrompt(args.prompt),
    n: 1,
    size,
    response_format: 'b64_json' as const,
    ...(args.negativePrompt ? { negative_prompt: args.negativePrompt } : {}),
  };

  log.info({ model, aspectRatio, prompt: args.prompt.slice(0, 80) }, 'requesting hero image from AI Gateway');

  const res = await fetch(`${AI_GATEWAY_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errBody: unknown;
    try {
      errBody = await res.json();
    } catch {
      errBody = await res.text();
    }
    throw new IntegrationError(
      'ai-gateway',
      `Image generation failed: ${res.status}`,
      res.status,
      errBody,
    );
  }

  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    usage?: { total_cost?: number };
  };
  const item = json.data?.[0];
  if (!item) {
    throw new IntegrationError('ai-gateway', 'Empty image response');
  }

  let buffer: Buffer;
  if (item.b64_json) {
    buffer = Buffer.from(item.b64_json, 'base64');
  } else if (item.url) {
    const dl = await fetch(item.url);
    if (!dl.ok) {
      throw new IntegrationError('ai-gateway', `Failed to download image: ${dl.status}`);
    }
    buffer = Buffer.from(await dl.arrayBuffer());
  } else {
    throw new IntegrationError('ai-gateway', 'Image response had neither b64_json nor url');
  }

  await mkdir(dirname(args.outputPath), { recursive: true });
  await writeFile(args.outputPath, buffer);

  const publicPath = '/' + args.outputPath.split('/public/').pop();

  return {
    path: args.outputPath,
    publicPath,
    size: buffer.byteLength,
    model,
    costUsd: json.usage?.total_cost,
  };
}

function sizeForAspect(aspect: string): string {
  switch (aspect) {
    case '16:9':
      return '1536x896';
    case '4:3':
      return '1408x1024';
    case '3:2':
      return '1536x1024';
    case '1:1':
    default:
      return '1024x1024';
  }
}

function enrichPrompt(prompt: string): string {
  // Default constraints on every hero image — keeps results consistent with
  // a "trustworthy local business website" aesthetic. The Content Engine's
  // prompt drives the actual subject matter.
  return [
    prompt,
    'Photorealistic, natural daylight, no text or logos in image, no watermarks, professional photography, high detail.',
  ].join(' ');
}

/**
 * Convenience: write into a build dir's `public/` folder using a stable name.
 */
export async function generateHeroImageInto(
  buildDir: string,
  prompt: string,
  filename = 'hero.jpg',
): Promise<GenerateImageResult | null> {
  const outputPath = resolve(buildDir, 'public', filename);
  return generateHeroImage({ prompt, outputPath });
}
