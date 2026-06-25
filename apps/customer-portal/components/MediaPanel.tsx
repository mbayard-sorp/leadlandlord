'use client';

/**
 * MediaPanel — Photos & Logo upload panel for the customer portal editor.
 *
 * Renders four image slots (logo, favicon, hero image, about image).
 * Each slot shows:
 *   - A label and description
 *   - The current image (thumbnail if URL is known, else "Current image set" text)
 *   - A file input + upload button
 *   - Upload status feedback
 *
 * Uses `useTransition` so uploads don't block other UI interactions.
 * Calls `onUploadSuccess` after each successful upload so EditorShell can
 * refresh the live preview iframe.
 */

import { useState, useTransition, useRef } from 'react';
import type { uploadImageAction } from '@/app/sites/[id]/edit/actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UploadAction = typeof uploadImageAction;

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
    label: 'Favicon',
    description: 'Small icon shown in browser tabs. Square PNG, 32x32 or 64x64 px.',
    aspect: '1:1',
  },
  {
    fieldKey: 'hero.image',
    label: 'Hero image',
    description: 'Background image for the hero section. Landscape 16:9 recommended.',
    aspect: '16:9',
  },
  {
    fieldKey: 'about.image',
    label: 'About image',
    description: 'Photo shown in the About section. 4:3 or square works best.',
    aspect: '4:3',
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
      className="mb-5 rounded p-4"
      style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
    >
      {/* Label row */}
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-fg)' }}>
          {slot.label}
        </span>
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {slot.aspect !== 'any' ? slot.aspect : ''}
        </span>
      </div>

      <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>
        {slot.description}
      </p>

      {/* Current image thumbnail or status text */}
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
        <p className="text-xs mb-3 italic" style={{ color: 'var(--color-muted)' }}>
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
          className="text-xs"
          style={{ color: 'var(--color-fg)', maxWidth: '220px' }}
          aria-label={`Choose ${slot.label} file`}
        />
        <button
          type="button"
          onClick={handleUpload}
          disabled={pending}
          className="inline-flex items-center justify-center min-h-[36px] px-3 py-1.5 text-xs font-medium rounded cursor-pointer transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
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
          className="mt-2 text-xs"
          style={{ color: status.ok ? 'var(--color-success)' : 'var(--color-error)' }}
        >
          {status.message}
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
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
          JPEG, PNG, or WebP. Max 8 MB per image.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
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
