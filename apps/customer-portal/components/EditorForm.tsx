'use client';

/**
 * EditorForm — curated text editor form for the customer portal.
 *
 * Groups fields by section and posts to `saveAction` via React's
 * `useActionState`. After a successful save it calls `onSaveSuccess` so
 * the parent (EditorShell) can refresh the preview iframe.
 *
 * Publish and Discard use `useTransition` so they don't clobber form state.
 *
 * D3: Sections are wrapped in a dnd-kit SortableContext. Each section header
 * has a drag handle and duplicate/remove buttons.
 *
 * D4: Exposes a `flushSave()` imperative handle (via ref) so EditorShell can
 * programmatically flush pending text edits before any structural op.
 */

import React, {
  useState,
  useActionState,
  useTransition,
  useRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SaveResult, PublishResult, DiscardResult } from '@/app/sites/[id]/edit/actions';
import type { ClientFieldDef, ClientSectionDef } from '@/lib/fields';
import { BS_SECTION_RULES } from '@leadlandlord/shared';

// ---------------------------------------------------------------------------
// Imperative handle (D4 flush)
// ---------------------------------------------------------------------------

export interface EditorFormHandle {
  /**
   * Programmatically submits the form and awaits the save result.
   * Resolves on success, throws on failure.
   * Short-circuits (resolves immediately) if the form is clean.
   */
  flushSave: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EditorFormProps {
  siteId: string;
  initialValues: Record<string, string>;
  sections: ClientSectionDef[];
  /** Phone + nav-CTA fields — rendered as "Your menu button & phone" group. */
  businessFields: ClientFieldDef[];
  /** SEO fields — rendered collapsed at the bottom. */
  seoFields: ClientFieldDef[];
  saveAction: (prev: SaveResult, formData: FormData) => Promise<SaveResult>;
  publishAction: (siteId: string) => Promise<PublishResult>;
  discardAction: (siteId: string) => Promise<DiscardResult>;
  onSaveSuccess: () => void;
  /** Structural callbacks (from EditorShell). */
  onReorder: (newOrder: ClientSectionDef[]) => void;
  onAdd: (sectionType: string) => void;
  onRemove: (sectionKey: string) => void;
  onDuplicate: (sectionKey: string) => void;
  isStructurallyLocked: boolean;
  /** Types the user can add (already filtered for singletons). */
  addableTypes: Array<keyof typeof BS_SECTION_RULES>;
  structuralPending: boolean;
  structuralError: string | null;
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
// Section group content (shared between sortable + locked variants)
// ---------------------------------------------------------------------------

function SectionGroupContent({
  section,
  values,
  errors,
  onRemove,
  onDuplicate,
  onDirty,
  isLocked,
  disabled,
  dragHandleProps,
}: {
  section: ClientSectionDef;
  values: Record<string, string>;
  errors: Record<string, string>;
  onRemove: (key: string) => void;
  onDuplicate: (key: string) => void;
  onDirty: () => void;
  isLocked: boolean;
  disabled: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLSpanElement>;
}) {
  const rule = BS_SECTION_RULES[section.sectionType as keyof typeof BS_SECTION_RULES];
  const canRemove = rule?.removable ?? false;
  const canDuplicate = !(rule?.singleton ?? true);

  if (section.fields.length === 0) return null;

  return (
    <details open className="mb-5">
      <summary
        className="cursor-pointer select-none text-sm font-semibold py-2 px-3 rounded"
        style={{
          background: 'var(--color-border)',
          color: 'var(--color-fg)',
          listStyle: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        {/* Drag handle — only when not locked */}
        {!isLocked && dragHandleProps && (
          <span
            {...dragHandleProps}
            title="Drag to reorder"
            style={{
              cursor: disabled ? 'not-allowed' : 'grab',
              touchAction: 'none',
              userSelect: 'none',
              color: 'var(--color-muted)',
              fontSize: '14px',
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            &#x2630;
          </span>
        )}

        {/* Label */}
        <span style={{ flex: 1 }}>{section.label}</span>

        {/* Duplicate button */}
        {canDuplicate && !isLocked && (
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault();
              onDuplicate(section.sectionKey);
            }}
            title="Duplicate section"
            style={{
              background: 'transparent',
              border: '1px solid var(--color-muted)',
              borderRadius: '4px',
              cursor: disabled ? 'not-allowed' : 'pointer',
              padding: '2px 6px',
              fontSize: '11px',
              color: 'var(--color-muted)',
              lineHeight: 1.4,
              flexShrink: 0,
            }}
          >
            Copy
          </button>
        )}

        {/* Remove button */}
        {canRemove && !isLocked && (
          <button
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.preventDefault();
              if (!confirm(`Remove the '${section.label}' section?`)) return;
              onRemove(section.sectionKey);
            }}
            title="Remove section"
            style={{
              background: 'transparent',
              border: '1px solid var(--color-error)',
              borderRadius: '4px',
              cursor: disabled ? 'not-allowed' : 'pointer',
              padding: '2px 6px',
              fontSize: '11px',
              color: 'var(--color-error)',
              lineHeight: 1.4,
              flexShrink: 0,
            }}
          >
            Remove
          </button>
        )}
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
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Sortable section group (dnd-kit) — used inside DndContext
// ---------------------------------------------------------------------------

function SortableSectionGroup({
  section,
  values,
  errors,
  onRemove,
  onDuplicate,
  onDirty,
  disabled,
}: {
  section: ClientSectionDef;
  values: Record<string, string>;
  errors: Record<string, string>;
  onRemove: (key: string) => void;
  onDuplicate: (key: string) => void;
  onDirty: () => void;
  disabled: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.sectionKey });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <SectionGroupContent
        section={section}
        values={values}
        errors={errors}
        onRemove={onRemove}
        onDuplicate={onDuplicate}
        onDirty={onDirty}
        isLocked={false}
        disabled={disabled}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Static section group — used when structurally locked
// ---------------------------------------------------------------------------

function StaticSectionGroup({
  section,
  values,
  errors,
  onRemove,
  onDuplicate,
  onDirty,
  disabled,
}: {
  section: ClientSectionDef;
  values: Record<string, string>;
  errors: Record<string, string>;
  onRemove: (key: string) => void;
  onDuplicate: (key: string) => void;
  onDirty: () => void;
  disabled: boolean;
}) {
  return (
    <SectionGroupContent
      section={section}
      values={values}
      errors={errors}
      onRemove={onRemove}
      onDuplicate={onDuplicate}
      onDirty={onDirty}
      isLocked={true}
      disabled={disabled}
    />
  );
}

// ---------------------------------------------------------------------------
// Add section picker
// ---------------------------------------------------------------------------

function AddSectionPicker({
  addableTypes,
  disabled,
  onAdd,
}: {
  addableTypes: Array<keyof typeof BS_SECTION_RULES>;
  disabled: boolean;
  onAdd: (type: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (addableTypes.length === 0) return null;

  return (
    <div style={{ position: 'relative', display: 'inline-block', marginBottom: '8px' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center min-h-[36px] px-3 py-1.5 text-xs font-medium rounded"
        style={{
          background: 'transparent',
          border: '1px dashed var(--color-accent)',
          color: 'var(--color-accent)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          gap: '4px',
        }}
      >
        + Add section
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10,
            }}
            onClick={() => setOpen(false)}
          />
          {/* Menu */}
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: '4px',
              zIndex: 20,
              background: 'var(--color-panel)',
              border: '1px solid var(--color-border)',
              borderRadius: '6px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              minWidth: '180px',
            }}
          >
            {addableTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAdd(type);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '8px 14px',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '13px',
                  color: 'var(--color-fg)',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                {BS_SECTION_RULES[type].label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
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

const EditorForm = forwardRef<EditorFormHandle, EditorFormProps>(function EditorForm(
  {
    siteId,
    initialValues,
    sections,
    businessFields,
    seoFields,
    saveAction,
    publishAction,
    discardAction,
    onSaveSuccess,
    onReorder,
    onAdd,
    onRemove,
    onDuplicate,
    isStructurallyLocked,
    addableTypes,
    structuralPending,
    structuralError,
  },
  ref,
) {
  const [saveState, formAction, isSaving] = useActionState(saveAction, INITIAL_SAVE_STATE);
  const [publishPending, startPublish] = useTransition();
  const [discardPending, startDiscard] = useTransition();

  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [discardResult, setDiscardResult] = useState<DiscardResult | null>(null);
  const [showDiscardModal, setShowDiscardModal] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  // Track "dirty" — any input change marks it dirty; save clears it.
  const dirtyRef = useRef(false);
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  // Resolve/reject for an in-flight programmatic flush (D4).
  const flushResolveRef = useRef<(() => void) | null>(null);
  const flushRejectRef = useRef<((err: Error) => void) | null>(null);

  // Notify parent after a successful save (once per success).
  const prevSaveOkRef = useRef(false);
  useEffect(() => {
    if (saveState.ok && !prevSaveOkRef.current) {
      prevSaveOkRef.current = true;
      dirtyRef.current = false;
      if (!saveState.noop) {
        onSaveSuccess();
        router.refresh();
      }
      // If there's a pending flush, resolve it.
      flushResolveRef.current?.();
      flushResolveRef.current = null;
      flushRejectRef.current = null;
    } else if (!saveState.ok) {
      prevSaveOkRef.current = false;
      // If there's a pending flush and we got a hard error (not just initial state), reject.
      if (saveState.message && flushRejectRef.current) {
        flushRejectRef.current(new Error(saveState.message));
        flushResolveRef.current = null;
        flushRejectRef.current = null;
      }
    }
  });

  // Scroll to first error field when validation fails.
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

  // Beforeunload guard for dirty form.
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // D4 imperative handle: flushSave.
  useImperativeHandle(
    ref,
    () => ({
      flushSave: (): Promise<void> => {
        if (!dirtyRef.current) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
          flushResolveRef.current = resolve;
          flushRejectRef.current = reject;
          // Programmatically submit the form.
          formRef.current?.requestSubmit();
        });
      },
    }),
    [],
  );

  const errors: Record<string, string> = saveState.errors ?? {};
  const hasErrors = Object.keys(errors).length > 0;
  const anyPending = isSaving || publishPending || discardPending || structuralPending;

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

  // ---------------------------------------------------------------------------
  // dnd-kit sensors and drag end handler
  // ---------------------------------------------------------------------------

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        // Require a 5px move before activating drag (avoids swallowing clicks
        // on the summary expand or the action buttons inside the header).
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sections.findIndex((s) => s.sectionKey === active.id);
      const newIndex = sections.findIndex((s) => s.sectionKey === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(sections, oldIndex, newIndex);
      onReorder(reordered);
    },
    [sections, onReorder],
  );

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
              {(isSaving || structuralPending) && (
                <span style={{ color: 'var(--color-muted)' }}>Saving...</span>
              )}
              {!isSaving && !structuralPending && saveState.ok && saveState.noop && (
                <span style={{ color: 'var(--color-muted)' }}>No changes to save</span>
              )}
              {!isSaving && !structuralPending && saveState.ok && !saveState.noop && (
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
        {structuralError && (
          <InfoBanner message={structuralError} type="error" />
        )}
        {isStructurallyLocked && (
          <InfoBanner
            message="This site is live. Section structure is locked, but text edits are still allowed."
            type="success"
          />
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
          onInput={markDirty}
        >
          {/* siteId hidden field — checked first in the server action */}
          <input type="hidden" name="siteId" value={siteId} />

          {/* 1. Sections first (Hero is first in the doc order) */}
          {!isStructurallyLocked ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sections.map((s) => s.sectionKey)}
                strategy={verticalListSortingStrategy}
              >
                {sections.map((section) => (
                  <SortableSectionGroup
                    key={section.sectionKey}
                    section={section}
                    values={initialValues}
                    errors={errors}
                    onRemove={onRemove}
                    onDuplicate={onDuplicate}
                    onDirty={markDirty}
                    disabled={anyPending}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            // Locked: render static (no drag handles, no structural controls).
            sections.map((section) => (
              <StaticSectionGroup
                key={section.sectionKey}
                section={section}
                values={initialValues}
                errors={errors}
                onRemove={onRemove}
                onDuplicate={onDuplicate}
                onDirty={markDirty}
                disabled={anyPending}
              />
            ))
          )}

          {/* Add section picker — shown below sections */}
          {!isStructurallyLocked && addableTypes.length > 0 && (
            <div className="mt-2 mb-4">
              <AddSectionPicker
                addableTypes={addableTypes}
                disabled={anyPending}
                onAdd={onAdd}
              />
            </div>
          )}

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
});

export default EditorForm;
