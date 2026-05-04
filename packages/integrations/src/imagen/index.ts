import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';

const AI_GATEWAY_BASE = 'https://ai-gateway.vercel.sh/v1';
const GOOGLE_AI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Hero image generation. Routes through one of:
 *
 *   1. Vercel AI Gateway  — if AI_GATEWAY_API_KEY is set.
 *      Get a key at https://vercel.com/dashboard/ai-gateway.
 *      Model controlled by IMAGEN_MODEL (default: google/imagen-3-fast).
 *
 *   2. Google AI Studio direct — if GOOGLE_API_KEY is set.
 *      Get a key at https://aistudio.google.com/apikey.
 *      Model controlled by GOOGLE_IMAGEN_MODEL (default:
 *      imagen-3.0-fast-generate-001).
 *
 *   3. No-op fallback — neither key set. Returns null and the variant
 *      component renders its placeholder background.
 *
 * Imagen costs ~$0.02–0.04 per image at Google list pricing. One hero per site.
 */
export interface GenerateImageArgs {
  prompt: string;
  aspectRatio?: '16:9' | '4:3' | '1:1' | '3:2';
  /** Where to save the result. The function downloads the bytes itself. */
  outputPath: string;
  /** Negative prompt — describe what NOT to put in the image (gateway only). */
  negativePrompt?: string;
}

export interface GenerateImageResult {
  /** Absolute path the image was written to. */
  path: string;
  /** Public-relative path (e.g., `/hero.jpg`) — used as the bundle URL. */
  publicPath: string;
  size: number;
  model: string;
  provider: 'ai-gateway' | 'google';
  costUsd?: number;
}

export async function generateHeroImage(args: GenerateImageArgs): Promise<GenerateImageResult | null> {
  const aiGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const googleKey = process.env.GOOGLE_API_KEY;

  if (aiGatewayKey) {
    return generateViaAiGateway(args, aiGatewayKey);
  }
  if (googleKey) {
    return generateViaGoogle(args, googleKey);
  }
  log.warn('No AI_GATEWAY_API_KEY or GOOGLE_API_KEY set — skipping hero image generation');
  return null;
}

async function generateViaAiGateway(
  args: GenerateImageArgs,
  key: string,
): Promise<GenerateImageResult> {
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

  log.info({ model, aspectRatio, prompt: args.prompt.slice(0, 80) }, 'requesting hero image (ai-gateway)');

  const res = await fetch(`${AI_GATEWAY_BASE}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await safeBody(res);
    throw new IntegrationError('ai-gateway', `Image generation failed: ${res.status}`, res.status, errBody);
  }

  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    usage?: { total_cost?: number };
  };
  const item = json.data?.[0];
  if (!item) {
    throw new IntegrationError('ai-gateway', 'Empty image response');
  }
  const buffer = await readImageBuffer(item);
  return persist(args.outputPath, buffer, model, 'ai-gateway', json.usage?.total_cost);
}

async function generateViaGoogle(
  args: GenerateImageArgs,
  key: string,
): Promise<GenerateImageResult> {
  const model = process.env.GOOGLE_IMAGEN_MODEL ?? 'imagen-3.0-fast-generate-001';
  const aspectRatio = args.aspectRatio ?? '16:9';

  // Google's Imagen API uses the predict endpoint with instances + parameters.
  const body = {
    instances: [{ prompt: enrichPrompt(args.prompt) }],
    parameters: {
      sampleCount: 1,
      aspectRatio,
      personGeneration: 'allow_adult', // we explicitly want photorealistic adults at distance
    },
  };

  log.info({ model, aspectRatio, prompt: args.prompt.slice(0, 80) }, 'requesting hero image (google)');

  const url = `${GOOGLE_AI_BASE}/models/${encodeURIComponent(model)}:predict?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await safeBody(res);
    throw new IntegrationError('google-imagen', `Image generation failed: ${res.status}`, res.status, errBody);
  }

  const json = (await res.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  };
  const item = json.predictions?.[0];
  if (!item?.bytesBase64Encoded) {
    throw new IntegrationError('google-imagen', 'Empty image response', undefined, json);
  }
  const buffer = Buffer.from(item.bytesBase64Encoded, 'base64');
  return persist(args.outputPath, buffer, model, 'google');
}

async function readImageBuffer(item: { b64_json?: string; url?: string }): Promise<Buffer> {
  if (item.b64_json) {
    return Buffer.from(item.b64_json, 'base64');
  }
  if (item.url) {
    const dl = await fetch(item.url);
    if (!dl.ok) {
      throw new IntegrationError('imagen', `Failed to download image: ${dl.status}`);
    }
    return Buffer.from(await dl.arrayBuffer());
  }
  throw new IntegrationError('imagen', 'Image response had neither b64_json nor url');
}

async function persist(
  outputPath: string,
  buffer: Buffer,
  model: string,
  provider: 'ai-gateway' | 'google',
  costUsd?: number,
): Promise<GenerateImageResult> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);
  const publicPath = '/' + outputPath.split('/public/').pop();
  return {
    path: outputPath,
    publicPath,
    size: buffer.byteLength,
    model,
    provider,
    costUsd,
  };
}

async function safeBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    try {
      return await res.text();
    } catch {
      return null;
    }
  }
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
