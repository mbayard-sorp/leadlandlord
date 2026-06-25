'use client';

/**
 * EditorForm — curated text editor form for the customer portal.
 *
 * Groups fields by section and posts to `saveAction` via React's
 * `useActionState`. After a successful save it calls `onSaveSuccess` so
 * the parent (EditorShell) can refresh the preview iframe.
 *
 * Publish and Discard use `useTransition` so they don't clobber form state.
 */

import {
  useState,
  useActionState,
  useTransition,
  useRef,
  useCallback,
  useEffect,
} from 'react';
import type { SaveResult, PublishResult, DiscardResult } from '@/app/sites/[id]/edit/actions';
import type { ClientFieldDef, ClientSectionDef } from '@/lib/fields';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EditorFormProps {
  siteId: string;
  initialValues: Record<string, string>;
  sections: ClientSectionDef[];
  topLevelFields: ClientFieldDef[];
  saveAction: (prev: SaveResult, formData: FormData) => Promise<SaveResult>;
  publishAction: (siteId: string) => Promise<PublishResult>;
  discardAction: (siteId: string) => Promise<DiscardResult>;
  onSaveSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Field renderer
// ---------------------------------------------------------------------------

function FieldControl({
  field,
  defaultValue,
  error,
}: {
  field: ClientFieldDef;
  defaultValue: string;
  error?: string;
}) {
  const inputClass = `input${error ? ' !border-red-400' : ''}`;

  return (
    <div className="mb-4">
      <label
        htmlFor={field.key}
        className="block text-sm font-medium mb-1"
        style={{ color: 'var(--color-fg)' }}
      >
        {field.label}
      </label>

      {field.control === 'textarea' ? (
        <textarea
          id={field.key}
          name={field.key}
          className={inputClass}
          defaultValue={defaultValue}
          placeholder={field.placeholder}
          rows={3}
          style={{ resize: 'vertical', minHeight: '80px' }}
        />
      ) : (
        <input
          id={field.key}
          name={field.key}
          type="text"
          className={inputClass}
          defaultValue={defaultValue}
          placeholder={field.placeholder}
        />
      )}

      {error && (
        <p className="mt-1 text-xs" style={{ color: 'var(--color-error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section group (collapsible)
// ---------------------------------------------------------------------------

function SectionGroup({
  section,
  values,
  errors,
}: {
  section: ClientSectionDef;
  values: Record<string, string>;
  errors: Record<string, string>;
}) {
  if (section.fields.length === 0) return null;

  return (
    <details open className="mb-5">
      <summary
        className="cursor-pointer select-none text-sm font-semibold py-2 px-3 rounded"
        style={{
          background: 'var(--color-border)',
          color: 'var(--color-fg)',
          listStyle: 'none',
        }}
      >
        {section.label}
      </summary>
      <div className="mt-3 pl-1">
        {section.fields.map((field) => (
          <FieldControl
            key={field.key}
            field={field}
            defaultValue={values[field.key] ?? ''}
            error={errors[field.key]}
          />
        ))}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Inline banners
// ---------------------------------------------------------------------------

function InfoBanner({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div
      className="px-4 py-2 text-xs"
      style={{
        background: type === 'success' ? '#f0fdf4' : '#fef2f2',
        color: type === 'success' ? 'var(--color-success)' : 'var(--color-error)',
      }}
    >
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Initial save state sentinel
// ---------------------------------------------------------------------------

const INITIAL_SAVE_STATE: SaveResult = { ok: false };

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function EditorForm({
  siteId,
  initialValues,
  sections,
  topLevelFields,
  saveAction,
  publishAction,
  discardAction,
  onSaveSuccess,
}: EditorFormProps) {
  const [saveState, formAction, isSaving] = useActionState(saveAction, INITIAL_SAVE_STATE);
  const [publishPending, startPublish] = useTransition();
  const [discardPending, startDiscard] = useTransition();

  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [discardResult, setDiscardResult] = useState<DiscardResult | null>(null);

  const formRef = useRef<HTMLFormElement>(null);

  // Notify parent after a successful save (once per success).
  const prevSaveOkRef = useRef(false);
  useEffect(() => {
    if (saveState.ok && !prevSaveOkRef.current) {
      prevSaveOkRef.current = true;
      onSaveSuccess();
    } else if (!saveState.ok) {
      prevSaveOkRef.current = false;
    }
  });

  const errors: Record<string, string> = saveState.errors ?? {};
  const anyPending = isSaving || publishPending || discardPending;

  const handlePublish = useCallback(() => {
    setPublishResult(null);
    startPublish(async () => {
      const result = await publishAction(siteId);
      setPublishResult(result);
    });
  }, [publishAction, siteId]);

  const handleDiscard = useCallback(() => {
    if (
      !confirm(
        'Discard all unsaved changes? This reverts to the last published version.',
      )
    ) {
      return;
    }
    setDiscardResult(null);
    startDiscard(async () => {
      const result = await discardAction(siteId);
      setDiscardResult(result);
    });
  }, [discardAction, siteId]);

  return (
    <div className="flex flex-col h-full">
      {/* Sticky action bar */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 border-b"
        style={{ background: 'var(--color-panel)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="submit"
            form="editor-form"
            disabled={anyPending}
            className="btn-primary text-sm px-4"
          >
            {isSaving ? 'Saving...' : 'Save draft'}
          </button>

          <button
            type="button"
            onClick={handlePublish}
            disabled={anyPending}
            className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 text-sm font-medium rounded border-0 cursor-pointer transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--color-success)', color: '#fff' }}
          >
            {publishPending ? 'Publishing...' : 'Publish'}
          </button>

          <button
            type="button"
            onClick={handleDiscard}
            disabled={anyPending}
            className="inline-flex items-center justify-center min-h-[44px] px-3 py-2 text-sm font-medium rounded cursor-pointer transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-muted)',
            }}
          >
            {discardPending ? 'Discarding...' : 'Discard'}
          </button>
        </div>

        {/* Status indicator */}
        <div className="shrink-0 text-xs">
          {isSaving && <span style={{ color: 'var(--color-muted)' }}>Saving...</span>}
          {!isSaving && saveState.ok && (
            <span style={{ color: 'var(--color-success)' }}>Saved as draft</span>
          )}
          {!isSaving && !saveState.ok && saveState.message && (
            <span style={{ color: 'var(--color-error)' }}>{saveState.message}</span>
          )}
        </div>
      </div>

      {/* Result banners */}
      {publishResult?.ok && (
        <InfoBanner
          message="Published! Changes will be live within ~60 seconds."
          type="success"
        />
      )}
      {publishResult && !publishResult.ok && publishResult.message && (
        <InfoBanner message={`Publish failed: ${publishResult.message}`} type="error" />
      )}
      {discardResult?.ok && (
        <InfoBanner message="Draft discarded. Reload the page to see the reverted content." type="success" />
      )}
      {discardResult && !discardResult.ok && discardResult.message && (
        <InfoBanner message={`Discard failed: ${discardResult.message}`} type="error" />
      )}

      {/* Form body */}
      <form
        id="editor-form"
        ref={formRef}
        action={formAction}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {/* siteId hidden field — checked first in the server action */}
        <input type="hidden" name="siteId" value={siteId} />

        {/* Top-level fields: SEO + nav CTA */}
        {topLevelFields.length > 0 && (
          <details open className="mb-5">
            <summary
              className="cursor-pointer select-none text-sm font-semibold py-2 px-3 rounded"
              style={{ background: 'var(--color-border)', color: 'var(--color-fg)', listStyle: 'none' }}
            >
              SEO &amp; Navigation
            </summary>
            <div className="mt-3 pl-1">
              {topLevelFields.map((field) => (
                <FieldControl
                  key={field.key}
                  field={field}
                  defaultValue={initialValues[field.key] ?? ''}
                  error={errors[field.key]}
                />
              ))}
            </div>
          </details>
        )}

        {/* Section groups */}
        {sections.map((section) => (
          <SectionGroup
            key={section.sectionKey}
            section={section}
            values={initialValues}
            errors={errors}
          />
        ))}
      </form>
    </div>
  );
}
