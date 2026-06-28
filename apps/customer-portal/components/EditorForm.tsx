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
import { useRouter } from 'next/navigation';
import type { SaveResult, PublishResult, DiscardResult } from '@/app/sites/[id]/edit/actions';
import type { ClientFieldDef, ClientSectionDef } from '@/lib/fields';

// ---------------------------------------------------------------------------
// Sections that have dynamic (add/remove-blocked) sub-items
// ---------------------------------------------------------------------------

const DYNAMIC_SECTION_KEYS = new Set(['services', 'about', 'process', 'footer', 'faq']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EditorFormProps {
  siteId: string;
  initialValues: Record<string, string>;
  sections: ClientSectionDef[];
  businessFields: ClientFieldDef[];
  seoFields: ClientFieldDef[];
  saveAction: (prev: SaveResult, formData: FormData) => Promise<SaveResult>;
  publishAction: (siteId: string) => Promise<PublishResult>;
  discardAction: (siteId: string) => Promise<DiscardResult>;
  onSaveSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Field control — renders label + description + input/textarea/select + counter
// ---------------------------------------------------------------------------

function FieldControl({
  field,
  defaultValue,
  error,
  onDirty,
}: {
  field: ClientFieldDef;
  defaultValue: string;
  error?: string;
  onDirty: () => void;
}) {
  const [length, setLength] = useState(defaultValue.length);
  const hasCounter = field.max !== undefined;
  const nearLimit = hasCounter && field.max !== undefined && length >= field.max - 10;
  const atLimit = hasCounter && field.max !== undefined && length >= field.max;

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    setLength(e.target.value.length);
    onDirty();
  }

  const inputClass = `input${error ? ' !border-red-400' : ''}`;
  const id = field.key;

  const counterColor = atLimit
    ? 'var(--color-error)'
    : nearLimit
    ? 'var(--color-warn)'
    : 'var(--color-muted)';

  return (
    <div className="mb-5">
      {/* Label row */}
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <label
          htmlFor={id}
          className="block text-sm font-semibold"
          style={{ color: 'var(--color-fg)' }}
        >
          {field.label}
          {field.required && (
            <span aria-label="required" style={{ color: 'var(--color-error)', marginLeft: '3px' }}>*</span>
          )}
        </label>
        {hasCounter && (
          <span
            className="text-xs tabular-nums shrink-0"
            style={{ color: counterColor }}
            aria-live="polite"
          >
            {length} / {field.max}
          </span>
        )}
      </div>

      {/* Helper text */}
      {field.description && (
        <p className="text-xs mb-2 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          {field.description}
        </p>
      )}

      {/* Control */}
      {field.control === 'textarea' ? (
        <textarea
          id={id}
          name={field.key}
          className={inputClass}
          defaultValue={defaultValue}
          placeholder={field.placeholder}
          maxLength={field.max}
          rows={3}
          style={{ resize: 'vertical', minHeight: '80px' }}
          onChange={handleChange}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-required={field.required}
        />
      ) : field.control === 'select' ? (
        <select
          id={id}
          name={field.key}
          className={inputClass}
          defaultValue={defaultValue}
          onChange={handleChange}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-required={field.required}
        >
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          name={field.key}
          type="text"
          className={inputClass}
          defaultValue={defaultValue}
          placeholder={field.placeholder}
          maxLength={field.max}
          onChange={handleChange}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-required={field.required}
        />
      )}

      {/* Validation error */}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs" style={{ color: 'var(--color-error)' }}>
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
  onDirty,
}: {
  section: ClientSectionDef;
  values: Record<string, string>;
  errors: Record<string, string>;
  onDirty: () => void;
}) {
  if (section.fields.length === 0) return null;
  const showDynamicNote = DYNAMIC_SECTION_KEYS.has(section.sectionKey);

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
            onDirty={onDirty}
          />
        ))}
        {showDynamicNote && (
          <p className="mt-2 mb-1 text-xs italic" style={{ color: 'var(--color-muted)' }}>
            Need to add or remove items here? Contact us and we&rsquo;ll set it up.
          </p>
        )}
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
      role="status"
      aria-live="polite"
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
// Discard confirmation modal
// ---------------------------------------------------------------------------

function DiscardModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15, 23, 42, 0.5)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="discard-modal-title"
    >
      <div
        className="w-full max-w-sm rounded-xl p-6 shadow-xl"
        style={{ background: 'var(--color-panel)' }}
      >
        <h2
          id="discard-modal-title"
          className="text-base font-semibold mb-2"
          style={{ color: 'var(--color-fg)' }}
        >
          Discard your unsaved changes?
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--color-muted)' }}>
          This brings back your last published version. Any edits you made will be lost.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="btn-outline"
            style={{ minHeight: '40px', padding: '0.375rem 1rem' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn-ghost"
            style={{ minHeight: '40px', padding: '0.375rem 1rem', color: 'var(--color-error)', borderColor: 'var(--color-error)' }}
          >
            Discard
          </button>
        </div>
      </div>
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
  businessFields,
  seoFields,
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
  const [showDiscardModal, setShowDiscardModal] = useState(false);

  // Unsaved-changes tracking (a ref, not state — it's only read inside the
  // beforeunload handler, so it must not trigger renders or setState-in-effect).
  const dirtyRef = useRef(false);
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  // Refresh the preview + re-fetch server data after each successful save.
  useEffect(() => {
    if (saveState.ok && !saveState.noop) {
      onSaveSuccess();
      router.refresh();
      dirtyRef.current = false;
    }
  }, [saveState, onSaveSuccess, router]);

  // Scroll to first error field when validation fails
  useEffect(() => {
    const errs = saveState.errors;
    if (!errs || Object.keys(errs).length === 0) return;
    const firstKey = Object.keys(errs)[0];
    if (!firstKey) return;
    const el = document.getElementById(firstKey);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus({ preventScroll: true });
    }
  }, [saveState]);

  // Beforeunload guard for dirty form
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const errors: Record<string, string> = saveState.errors ?? {};
  const hasErrors = Object.keys(errors).length > 0;
  const anyPending = isSaving || publishPending || discardPending;

  const handlePublish = useCallback(() => {
    setPublishResult(null);
    startPublish(async () => {
      const result = await publishAction(siteId);
      setPublishResult(result);
      if (result.ok) router.refresh();
    });
  }, [publishAction, siteId, router]);

  const handleDiscardConfirm = useCallback(() => {
    setShowDiscardModal(false);
    setDiscardResult(null);
    startDiscard(async () => {
      const result = await discardAction(siteId);
      setDiscardResult(result);
      if (result.ok) {
        router.refresh();
        dirtyRef.current = false;
      }
    });
  }, [discardAction, siteId, router]);

  return (
    <>
      {showDiscardModal && (
        <DiscardModal
          onConfirm={handleDiscardConfirm}
          onCancel={() => setShowDiscardModal(false)}
        />
      )}

      <div className="flex flex-col h-full">
        {/* Sticky action bar */}
        <div
          className="sticky top-0 z-10 border-b"
          style={{ background: 'var(--color-panel)', borderColor: 'var(--color-border)' }}
        >
          {/* Explainer line */}
          <p className="px-4 pt-2.5 pb-0 text-xs" style={{ color: 'var(--color-muted)' }}>
            Save keeps a private draft. Publish makes your changes live on your website.
          </p>

          {/* Buttons + status row */}
          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Publish — dominant CTA */}
              <button
                type="button"
                onClick={handlePublish}
                disabled={anyPending}
                className="btn-cta"
              >
                {publishPending ? 'Publishing...' : 'Publish'}
              </button>

              {/* Save draft — secondary */}
              <button
                type="submit"
                form="editor-form"
                disabled={anyPending}
                className="btn-outline"
              >
                {isSaving ? 'Saving...' : 'Save draft'}
              </button>

              {/* Discard — ghost */}
              <button
                type="button"
                onClick={() => setShowDiscardModal(true)}
                disabled={anyPending}
                className="btn-ghost"
              >
                {discardPending ? 'Discarding...' : 'Discard'}
              </button>
            </div>

            {/* Status indicator */}
            <div className="shrink-0 text-xs" aria-live="polite">
              {isSaving && <span style={{ color: 'var(--color-muted)' }}>Saving...</span>}
              {!isSaving && saveState.ok && saveState.noop && (
                <span style={{ color: 'var(--color-muted)' }}>No changes to save</span>
              )}
              {!isSaving && saveState.ok && !saveState.noop && (
                <span style={{ color: 'var(--color-success)' }}>Saved as draft</span>
              )}
              {!isSaving && !saveState.ok && saveState.message && (
                <span style={{ color: 'var(--color-error)' }}>{saveState.message}</span>
              )}
            </div>
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
          <InfoBanner message="Draft discarded — your live version is back." type="success" />
        )}
        {discardResult && !discardResult.ok && discardResult.message && (
          <InfoBanner message={`Discard failed: ${discardResult.message}`} type="error" />
        )}

        {/* Error summary banner */}
        {hasErrors && (
          <div
            className="px-4 py-2.5 text-sm border-b"
            role="alert"
            aria-live="assertive"
            style={{
              background: '#fef2f2',
              color: 'var(--color-error)',
              borderColor: '#fecaca',
            }}
          >
            Please fix the highlighted fields below.
          </div>
        )}

        {/* Form body */}
        <form
          id="editor-form"
          ref={formRef}
          action={formAction}
          className="flex-1 overflow-y-auto px-4 py-4"
          onChange={markDirty}
        >
          {/* siteId hidden field — checked first in the server action */}
          <input type="hidden" name="siteId" value={siteId} />

          {/* 1. Sections first (Hero is first in the registry) */}
          {sections.map((section) => (
            <SectionGroup
              key={section.sectionKey}
              section={section}
              values={initialValues}
              errors={errors}
              onDirty={markDirty}
            />
          ))}

          {/* 2. Business fields: phone + menu button */}
          {businessFields.length > 0 && (
            <details open className="mb-5">
              <summary
                className="cursor-pointer select-none text-sm font-semibold py-2 px-3 rounded"
                style={{ background: 'var(--color-border)', color: 'var(--color-fg)', listStyle: 'none' }}
              >
                Your menu button &amp; phone
              </summary>
              <div className="mt-3 pl-1">
                {businessFields.map((field) => (
                  <FieldControl
                    key={field.key}
                    field={field}
                    defaultValue={initialValues[field.key] ?? ''}
                    error={errors[field.key]}
                    onDirty={markDirty}
                  />
                ))}
              </div>
            </details>
          )}

          {/* 3. SEO fields — collapsed, last */}
          {seoFields.length > 0 && (
            <details className="mb-5">
              <summary
                className="cursor-pointer select-none text-sm font-semibold py-2 px-3 rounded"
                style={{ background: 'var(--color-border)', color: 'var(--color-fg)', listStyle: 'none' }}
              >
                Search engine listing (optional)
              </summary>
              <div className="mt-3 pl-1">
                <p className="text-xs mb-4 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                  Fine-tune how your site looks in Google search. Optional — we fill this in for you.
                </p>
                {seoFields.map((field) => (
                  <FieldControl
                    key={field.key}
                    field={field}
                    defaultValue={initialValues[field.key] ?? ''}
                    error={errors[field.key]}
                    onDirty={markDirty}
                  />
                ))}
              </div>
            </details>
          )}
        </form>
      </div>
    </>
  );
}
