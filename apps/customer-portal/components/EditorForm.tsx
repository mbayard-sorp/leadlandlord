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
  topLevelFields: ClientFieldDef[];
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
// Section group content (shared between sortable + locked variants)
// ---------------------------------------------------------------------------

function SectionGroupContent({
  section,
  values,
  errors,
  onRemove,
  onDuplicate,
  isLocked,
  disabled,
  dragHandleProps,
}: {
  section: ClientSectionDef;
  values: Record<string, string>;
  errors: Record<string, string>;
  onRemove: (key: string) => void;
  onDuplicate: (key: string) => void;
  isLocked: boolean;
  disabled: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLSpanElement>;
}) {
  const rule = BS_SECTION_RULES[section.sectionType as keyof typeof BS_SECTION_RULES];
  const canRemove = rule?.removable ?? false;
  const canDuplicate = !(rule?.singleton ?? true);

  if (section.fields.length === 0) return null;

  return (
    <details open>
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
  disabled,
}: {
  section: ClientSectionDef;
  values: Record<string, string>;
  errors: Record<string, string>;
  onRemove: (key: string) => void;
  onDuplicate: (key: string) => void;
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
    <div ref={setNodeRef} style={style} className="mb-5">
      <SectionGroupContent
        section={section}
        values={values}
        errors={errors}
        onRemove={onRemove}
        onDuplicate={onDuplicate}
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
  disabled,
}: {
  section: ClientSectionDef;
  values: Record<string, string>;
  errors: Record<string, string>;
  onRemove: (key: string) => void;
  onDuplicate: (key: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="mb-5">
      <SectionGroupContent
        section={section}
        values={values}
        errors={errors}
        onRemove={onRemove}
        onDuplicate={onDuplicate}
        isLocked={true}
        disabled={disabled}
      />
    </div>
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

const EditorForm = forwardRef<EditorFormHandle, EditorFormProps>(function EditorForm(
  {
    siteId,
    initialValues,
    sections,
    topLevelFields,
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

  const formRef = useRef<HTMLFormElement>(null);

  // Track "dirty" — any keydown in the form marks it dirty; save clears it.
  const isDirtyRef = useRef(false);
  // Resolve/reject for an in-flight programmatic flush.
  const flushResolveRef = useRef<(() => void) | null>(null);
  const flushRejectRef = useRef<((err: Error) => void) | null>(null);

  // Notify parent after a successful save (once per success).
  const prevSaveOkRef = useRef(false);
  useEffect(() => {
    if (saveState.ok && !prevSaveOkRef.current) {
      prevSaveOkRef.current = true;
      isDirtyRef.current = false;
      onSaveSuccess();
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

  // D4 imperative handle: flushSave.
  useImperativeHandle(
    ref,
    () => ({
      flushSave: (): Promise<void> => {
        if (!isDirtyRef.current) return Promise.resolve();
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
  const anyPending = isSaving || publishPending || discardPending || structuralPending;

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
          {(isSaving || structuralPending) && (
            <span style={{ color: 'var(--color-muted)' }}>Saving...</span>
          )}
          {!isSaving && !structuralPending && saveState.ok && (
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
      {structuralError && (
        <InfoBanner message={structuralError} type="error" />
      )}
      {isStructurallyLocked && (
        <InfoBanner
          message="This site is live. Section structure is locked, but text edits are still allowed."
          type="success"
        />
      )}

      {/* Form body */}
      <form
        id="editor-form"
        ref={formRef}
        action={formAction}
        className="flex-1 overflow-y-auto px-4 py-4"
        onInput={() => { isDirtyRef.current = true; }}
        onChange={() => { isDirtyRef.current = true; }}
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

        {/* Section structure: drag-drop reorder + per-section controls */}
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
              disabled={anyPending}
            />
          ))
        )}

        {/* Add section picker — shown below sections, above footer area */}
        {!isStructurallyLocked && addableTypes.length > 0 && (
          <div className="mt-2 mb-4">
            <AddSectionPicker
              addableTypes={addableTypes}
              disabled={anyPending}
              onAdd={onAdd}
            />
          </div>
        )}
      </form>
    </div>
  );
});

export default EditorForm;
