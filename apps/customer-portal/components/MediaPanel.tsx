'use client';

/**
 * MediaPanel — Photos & Logo upload panel for the customer portal editor.
 *
 * Renders five image slots: logo, browser-tab icon (favicon), hero image,
 * about image, and social share image (seo.ogImage).
 * Each slot shows:
 *   - A label and description
 *   - The current image (thumbnail if URL is known, else "No image set yet")
 *   - A file input + upload button
 *   - Upload status feedback
 *
 * Uses `useTransition` so uploads don't block other UI interactions.
 * Calls `onUploadSuccess` after each successful upload so EditorShell can
 * refresh the live preview iframe.
 */

import { useState, useTransition, useRef } from 'react';
import type { uploadImageAction, generateImageAction } from '@/app/sites/[id]/edit/actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UploadAction = typeof uploadImageAction;
type GenerateAction = typeof generateImageAction;

interface ImageSlot {
  fieldKey: string;
  label: string;
  description: string;
  aspect: string;
}

interface MediaPanelProps {
  siteId: string;
  /** Initial CDN URLs keyed by fieldKey, if derivable from the doc. */
  initialThumbnails: Record<string, string | undefined>;
  uploadImageAction: UploadAction;
  generateImageAction: GenerateAction;
  /** AI image generations already used by this site. */
  generationsUsed: number;
  /** Hard cap on AI generations per site. */
  generationLimit: number;
  onUploadSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Slot definitions
// ---------------------------------------------------------------------------

const IMAGE_SLOTS: ImageSlot[] = [
  {
    fieldKey: 'logo',
    label: 'Logo',
    description: 'Your business logo shown in the header. PNG with transparent background recommended.',
    aspect: 'any',
  },
  {
    fieldKey: 'favicon',
    label: 'Browser tab icon',
    description: 'Small icon shown in browser tabs when someone visits your site. Square PNG, 32x32 or 64x64 px recommended.',
    aspect: '1:1',
  },
  {
    fieldKey: 'hero.image',
    label: 'Hero image',
    description: 'Background image for the top of your site. Landscape 16:9 recommended.',
    aspect: '16:9',
  },
  {
    fieldKey: 'about.image',
    label: 'About image',
    description: 'Photo shown in the About section — your team, shop, or job in progress. 4:3 or square works best.',
    aspect: '4:3',
  },
  {
    fieldKey: 'seo.ogImage',
    label: 'Social share image',
    description: 'Shown when your site link is shared on Facebook, LinkedIn, or text messages. Use a clear photo or your logo. Landscape ~1200×630 works best.',
    aspect: '1.91:1',
  },
];

// ---------------------------------------------------------------------------
// Single slot component
// ---------------------------------------------------------------------------

interface SlotProps {
  siteId: string;
  slot: ImageSlot;
  thumbnailUrl: string | undefined;
  uploadImageAction: UploadAction;
  onUploadSuccess: () => void;
}

function ImageSlotRow({ siteId, slot, thumbnailUrl, uploadImageAction: doUpload, onUploadSuccess }: SlotProps) {
  const [pending, startUpload] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [currentThumb, setCurrentThumb] = useState<string | undefined>(thumbnailUrl);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleUpload() {
    const input = inputRef.current;
    if (!input?.files?.length) {
      setStatus({ ok: false, message: 'Please select a file first.' });
      return;
    }
    const file = input.files[0];
    if (!file) return;

    setStatus(null);
    const formData = new FormData();
    formData.set('file', file);

    startUpload(async () => {
      const result = await doUpload(siteId, slot.fieldKey, formData);
      if (result.ok && result.assetUrl) {
        setCurrentThumb(result.assetUrl);
        setStatus({ ok: true, message: 'Uploaded successfully.' });
        onUploadSuccess();
        // Clear the file input so re-selecting the same file works.
        if (inputRef.current) inputRef.current.value = '';
      } else {
        setStatus({ ok: false, message: result.error ?? 'Upload failed. Please try again.' });
      }
    });
  }

  return (
    <div
      className="mb-5 rounded-lg p-4"
      style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
    >
      {/* Label row */}
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-fg)' }}>
          {slot.label}
        </span>
        {slot.aspect !== 'any' && (
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {slot.aspect}
          </span>
        )}
      </div>

      <p className="text-sm mb-3 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
        {slot.description}
      </p>

      {/* Current image thumbnail or placeholder */}
      {currentThumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={currentThumb}
          alt={`Current ${slot.label}`}
          className="mb-3 rounded object-cover"
          style={{
            maxHeight: '80px',
            maxWidth: '160px',
            border: '1px solid var(--color-border)',
          }}
        />
      ) : (
        <p className="text-sm mb-3 italic" style={{ color: 'var(--color-muted)' }}>
          No image set yet.
        </p>
      )}

      {/* File input + upload button */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={pending}
          className="text-sm"
          style={{ color: 'var(--color-fg)', maxWidth: '220px' }}
          aria-label={`Choose ${slot.label} file`}
        />
        <button
          type="button"
          onClick={handleUpload}
          disabled={pending}
          className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 text-sm font-medium rounded-lg cursor-pointer transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: 'var(--color-accent)',
            color: '#fff',
            border: 'none',
          }}
        >
          {pending ? 'Uploading...' : 'Upload'}
        </button>
      </div>

      {/* Status message */}
      {status && (
        <p
          className="mt-2 text-sm"
          role="status"
          aria-live="polite"
          style={{ color: status.ok ? 'var(--color-success)' : 'var(--color-error)' }}
        >
          {status.message}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI image generator
// ---------------------------------------------------------------------------

const GENERATE_TARGETS: { fieldKey: string; label: string }[] = [
  { fieldKey: 'hero.image', label: 'Hero image' },
  { fieldKey: 'about.image', label: 'About image' },
  { fieldKey: 'logo', label: 'Logo' },
  { fieldKey: 'seo.ogImage', label: 'Social share image' },
];

function AiImageGenerator({
  siteId,
  generationsUsed,
  generationLimit,
  generateImageAction: doGenerate,
  onGenerated,
}: {
  siteId: string;
  generationsUsed: number;
  generationLimit: number;
  generateImageAction: GenerateAction;
  onGenerated: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [target, setTarget] = useState(GENERATE_TARGETS[0]!.fieldKey);
  const [pending, startGen] = useTransition();
  const [remaining, setRemaining] = useState(Math.max(0, generationLimit - generationsUsed));
  const [result, setResult] = useState<{ ok: boolean; message: string; url?: string } | null>(null);

  const noneLeft = remaining <= 0;

  function handleGenerate() {
    const p = prompt.trim();
    if (!p) {
      setResult({ ok: false, message: 'Describe the image you want first.' });
      return;
    }
    setResult(null);
    startGen(async () => {
      const r = await doGenerate(siteId, target, p);
      if (typeof r.remaining === 'number') setRemaining(r.remaining);
      if (r.ok) {
        const label = GENERATE_TARGETS.find((t) => t.fieldKey === target)?.label ?? 'your site';
        setResult({
          ok: true,
          message: `Image created and applied to your ${label}. Save to keep it.`,
          url: r.assetUrl,
        });
        onGenerated();
      } else {
        setResult({ ok: false, message: r.error ?? 'Generation failed. Please try again.' });
      }
    });
  }

  return (
    <div
      className="mb-5 rounded-lg p-4"
      style={{ border: '1px solid var(--color-accent)', background: 'var(--color-surface)' }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-fg)' }}>
          Generate an image with AI
        </span>
        <span
          className="text-xs tabular-nums shrink-0"
          style={{ color: noneLeft ? 'var(--color-error)' : 'var(--color-muted)' }}
        >
          {remaining} of {generationLimit} left
        </span>
      </div>
      <p className="text-sm mb-3 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
        Describe the photo you want and we&rsquo;ll create one and drop it into your site.
        You get {generationLimit} generations for this site.
      </p>

      <label htmlFor="ai-prompt" className="block text-sm font-medium mb-1" style={{ color: 'var(--color-fg)' }}>
        What should the image show?
      </label>
      <textarea
        id="ai-prompt"
        className="input"
        rows={3}
        maxLength={500}
        placeholder="A clean, modern auto repair shop with a mechanic working on a car"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={pending || noneLeft}
        style={{ resize: 'vertical', minHeight: '72px' }}
      />

      <label htmlFor="ai-target" className="block text-sm font-medium mt-3 mb-1" style={{ color: 'var(--color-fg)' }}>
        Use it as
      </label>
      <select
        id="ai-target"
        className="input"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        disabled={pending || noneLeft}
      >
        {GENERATE_TARGETS.map((t) => (
          <option key={t.fieldKey} value={t.fieldKey}>
            {t.label}
          </option>
        ))}
      </select>

      <div className="mt-3">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={pending || noneLeft || !prompt.trim()}
          className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 text-sm font-medium rounded-lg cursor-pointer transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: 'var(--color-accent)', color: '#fff', border: 'none' }}
        >
          {pending ? 'Generating…' : noneLeft ? 'No generations left' : 'Generate image'}
        </button>
      </div>

      {result?.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={result.url}
          alt="AI generated preview"
          className="mt-3 rounded object-cover"
          style={{ maxHeight: '120px', maxWidth: '220px', border: '1px solid var(--color-border)' }}
        />
      )}
      {result && (
        <p
          className="mt-2 text-sm"
          role="status"
          aria-live="polite"
          style={{ color: result.ok ? 'var(--color-success)' : 'var(--color-error)' }}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function MediaPanel({
  siteId,
  initialThumbnails,
  uploadImageAction: doUpload,
  generateImageAction: doGenerate,
  generationsUsed,
  generationLimit,
  onUploadSuccess,
}: MediaPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <div
        className="px-4 py-3 border-b shrink-0"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-fg)' }}>
          Photos &amp; Logo
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          JPEG, PNG, or WebP. Max 8 MB per image.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <AiImageGenerator
          siteId={siteId}
          generationsUsed={generationsUsed}
          generationLimit={generationLimit}
          generateImageAction={doGenerate}
          onGenerated={onUploadSuccess}
        />
        {IMAGE_SLOTS.map((slot) => (
          <ImageSlotRow
            key={slot.fieldKey}
            siteId={siteId}
            slot={slot}
            thumbnailUrl={initialThumbnails[slot.fieldKey]}
            uploadImageAction={doUpload}
            onUploadSuccess={onUploadSuccess}
          />
        ))}
      </div>
    </div>
  );
}
