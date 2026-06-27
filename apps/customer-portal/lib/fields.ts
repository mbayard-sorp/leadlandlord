/**
 * Declarative field registry for the customer portal text editor.
 *
 * Defines:
 *   - Which sections/fields the customer can edit (the v1 allowlist)
 *   - Zod validation rules per field
 *   - How to build granular Sanity patch paths from form values + live doc
 *   - How to extract current values from the doc for form prefill
 *
 * HARD-BLOCKED (never settable from this registry):
 *   draftMode, robotsDisallow, themeLocked, slug, theme.*, placeId, rating,
 *   reviewCount, purchaseUrl, ownerEmail, generatedAt, *ImagePrompt,
 *   migrated.*, sections[] add/remove/reorder, reviews[] references,
 *   contact.formEndpoint, seo.ogImage, navShowPhone, navigation[],
 *   hero.imageB/imageC. Images (logo/favicon/hero.image/about.image) are M4.
 *
 * Identity model (D1 refactor):
 *   _type  = the section TYPE (e.g. 'bsHeroSection').
 *   _key   = an OPAQUE INSTANCE ID (e.g. 'hero', or a generated alphanumeric).
 *   Multiple sections of the same _type can coexist and are addressed independently.
 *
 * Form field key scheme:
 *   Top-level:  'navCta.label', 'seo.metaTitle', …
 *   Section:    'sec.<sectionKey>.<relativePath>'   (e.g. 'sec.hero.eyebrow')
 *   Sub-items:  'sec.<sectionKey>.card.<itemKey>.title'
 *               'sec.<sectionKey>.stat.<itemKey>.value'
 *               'sec.<sectionKey>.step.<itemKey>.title'
 *               'sec.<sectionKey>.col.<colKey>.heading'
 *               'sec.<sectionKey>.col.<colKey>.link.<linkKey>.label'
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared zod primitives
// ---------------------------------------------------------------------------

/** Rejects any string containing a `<` character (no HTML injection). */
const noHtml = (s: z.ZodString) => s.refine((v) => !v.includes('<'), 'HTML is not allowed');

const shortText = noHtml(z.string().trim().max(120));
const shortTextOpt = noHtml(z.string().trim().max(120)).optional().or(z.literal(''));
const mediumTextOpt = noHtml(z.string().trim().max(300)).optional().or(z.literal(''));
const longTextOpt = noHtml(z.string().trim().max(2000)).optional().or(z.literal(''));
const statValue = noHtml(z.string().trim().max(20)).optional().or(z.literal(''));
const ctaStyle = z.enum(['primary', 'secondary', 'ghost']).optional().or(z.literal(''));
const ctaHref = z
  .string()
  .trim()
  .refine(
    (v) =>
      v === '' ||
      v.startsWith('#') ||
      v.startsWith('tel:') ||
      v.startsWith('https://'),
    'Must be an anchor (#…), tel: link, or https:// URL',
  )
  .optional()
  .or(z.literal(''));

// ---------------------------------------------------------------------------
// Field descriptor types
// ---------------------------------------------------------------------------

export type ControlType = 'input' | 'textarea';

export interface FieldDef {
  /** Unique key used as the HTML form field name. */
  key: string;
  label: string;
  control: ControlType;
  schema: z.ZodTypeAny;
  /** Optional placeholder text shown in the form control. */
  placeholder?: string;
}

export interface SectionDef {
  /** Sanity section `_type` (e.g. 'bsHeroSection'). */
  sectionType: string;
  /** The INSTANCE `_key` for this section in the doc. */
  sectionKey: string;
  label: string;
  fields: FieldDef[];
}

// ---------------------------------------------------------------------------
// Serializable client projections
//
// FieldDef carries a zod `schema`, which is NOT serializable across the
// Server -> Client component boundary (passing it as a prop throws a runtime
// error). Client components only need rendering metadata, so the server page
// passes these stripped projections instead. Schemas stay server-side for
// validation in the save action.
// ---------------------------------------------------------------------------

export type ClientFieldDef = Omit<FieldDef, 'schema'>;

export interface ClientSectionDef {
  /** The section `_type`. */
  sectionType: string;
  /** The INSTANCE `_key`. */
  sectionKey: string;
  label: string;
  fields: ClientFieldDef[];
}

export function toClientField(field: FieldDef): ClientFieldDef {
  return {
    key: field.key,
    label: field.label,
    control: field.control,
    placeholder: field.placeholder,
  };
}

export function toClientSection(section: SectionDef): ClientSectionDef {
  return {
    sectionType: section.sectionType,
    sectionKey: section.sectionKey,
    label: section.label,
    fields: section.fields.map(toClientField),
  };
}

// ---------------------------------------------------------------------------
// Top-level fields (not inside sections[])
// ---------------------------------------------------------------------------

export const topLevelFields: FieldDef[] = [
  { key: 'navCta.label', label: 'Nav button label', control: 'input', schema: shortTextOpt },
  { key: 'navCta.href', label: 'Nav button link', control: 'input', schema: ctaHref, placeholder: '#contact or tel:+1...' },
  { key: 'seo.metaTitle', label: 'Page title (SEO)', control: 'input', schema: shortTextOpt, placeholder: '50–60 characters recommended' },
  { key: 'seo.metaDescription', label: 'Meta description (SEO)', control: 'textarea', schema: mediumTextOpt, placeholder: '150–160 characters recommended' },
];

// ---------------------------------------------------------------------------
// Per-_type field templates
//
// Keys are RELATIVE to the section instance, no leading section name.
// e.g. 'eyebrow' not 'hero.eyebrow'. The full form key is assembled as:
//   'sec.<sectionKey>.<relativeKey>'
//
// Sub-item fields (cards, stats, steps, columns) are generated dynamically
// by buildSectionList() and are NOT listed here.
// ---------------------------------------------------------------------------

interface SectionTemplate {
  label: string;
  /** Static (scalar) relative field keys for this section type. */
  fields: Array<Omit<FieldDef, 'key'> & { relKey: string }>;
}

const sectionTemplates: Record<string, SectionTemplate> = {
  bsHeroSection: {
    label: 'Hero',
    fields: [
      { relKey: 'eyebrow', label: 'Eyebrow text', control: 'input', schema: shortTextOpt },
      { relKey: 'headline', label: 'Headline', control: 'input', schema: shortText },
      { relKey: 'highlight', label: 'Highlighted word(s)', control: 'input', schema: shortTextOpt, placeholder: 'Words to emphasise in the headline' },
      { relKey: 'subhead', label: 'Subheading', control: 'textarea', schema: mediumTextOpt },
      { relKey: 'primaryCta.label', label: 'Primary button label', control: 'input', schema: shortTextOpt },
      { relKey: 'primaryCta.href', label: 'Primary button link', control: 'input', schema: ctaHref, placeholder: '#contact or tel:+1...' },
      { relKey: 'primaryCta.style', label: 'Primary button style', control: 'input', schema: ctaStyle, placeholder: 'primary | secondary | ghost' },
      { relKey: 'secondaryCta.label', label: 'Secondary button label', control: 'input', schema: shortTextOpt },
      { relKey: 'secondaryCta.href', label: 'Secondary button link', control: 'input', schema: ctaHref, placeholder: '#contact or tel:+1...' },
      { relKey: 'secondaryCta.style', label: 'Secondary button style', control: 'input', schema: ctaStyle, placeholder: 'primary | secondary | ghost' },
    ],
  },
  bsServicesSection: {
    label: 'Services',
    fields: [
      { relKey: 'eyebrow', label: 'Eyebrow text', control: 'input', schema: shortTextOpt },
      { relKey: 'heading', label: 'Heading', control: 'input', schema: shortText },
      { relKey: 'subhead', label: 'Subheading', control: 'textarea', schema: mediumTextOpt },
      // Per-card fields are generated dynamically in buildSectionList().
    ],
  },
  bsAboutSection: {
    label: 'About',
    fields: [
      { relKey: 'eyebrow', label: 'Eyebrow text', control: 'input', schema: shortTextOpt },
      { relKey: 'heading', label: 'Heading', control: 'input', schema: shortTextOpt },
      { relKey: 'body', label: 'Body text', control: 'textarea', schema: longTextOpt },
      { relKey: 'cta.label', label: 'CTA label', control: 'input', schema: shortTextOpt },
      { relKey: 'cta.href', label: 'CTA link', control: 'input', schema: ctaHref, placeholder: '#contact or tel:+1...' },
      // Per-stat fields are generated dynamically in buildSectionList().
    ],
  },
  bsProcessSection: {
    label: 'How It Works',
    fields: [
      { relKey: 'eyebrow', label: 'Eyebrow text', control: 'input', schema: shortTextOpt },
      { relKey: 'heading', label: 'Heading', control: 'input', schema: shortText },
      // Per-step fields are generated dynamically in buildSectionList().
    ],
  },
  bsReviewsSection: {
    label: 'Reviews',
    fields: [
      { relKey: 'eyebrow', label: 'Eyebrow text', control: 'input', schema: shortTextOpt },
      { relKey: 'heading', label: 'Heading', control: 'input', schema: shortTextOpt },
      // reviews[] references are BLOCKED — no per-review editing.
    ],
  },
  bsContactSection: {
    label: 'Contact',
    fields: [
      { relKey: 'heading', label: 'Heading', control: 'input', schema: shortTextOpt },
      { relKey: 'subhead', label: 'Subheading', control: 'textarea', schema: mediumTextOpt },
      { relKey: 'address.street', label: 'Street address', control: 'input', schema: shortTextOpt },
      { relKey: 'address.city', label: 'City', control: 'input', schema: shortTextOpt },
      { relKey: 'address.state', label: 'State', control: 'input', schema: shortTextOpt },
      { relKey: 'address.zip', label: 'ZIP code', control: 'input', schema: shortTextOpt },
      { relKey: 'address.hours', label: 'Business hours', control: 'input', schema: shortTextOpt, placeholder: 'e.g. Mon–Sat 7am–6pm' },
      { relKey: 'address.serviceArea', label: 'Service area', control: 'input', schema: shortTextOpt, placeholder: 'e.g. Greater Phoenix metro' },
      { relKey: 'formLabels.name', label: 'Form — Name label', control: 'input', schema: shortTextOpt },
      { relKey: 'formLabels.phone', label: 'Form — Phone label', control: 'input', schema: shortTextOpt },
      { relKey: 'formLabels.email', label: 'Form — Email label', control: 'input', schema: shortTextOpt },
      { relKey: 'formLabels.message', label: 'Form — Message label', control: 'input', schema: shortTextOpt },
      { relKey: 'formLabels.submit', label: 'Form — Submit button label', control: 'input', schema: shortTextOpt },
    ],
  },
  bsUgcSection: {
    label: 'Social Gallery',
    fields: [
      { relKey: 'heading', label: 'Heading', control: 'input', schema: shortTextOpt },
      { relKey: 'subhead', label: 'Subheading', control: 'textarea', schema: mediumTextOpt },
    ],
  },
  bsFooterSection: {
    label: 'Footer',
    fields: [
      { relKey: 'tagline', label: 'Tagline', control: 'input', schema: shortTextOpt },
      { relKey: 'legal', label: 'Legal row text', control: 'input', schema: shortTextOpt },
      // Per-column/link fields are generated dynamically in buildSectionList().
    ],
  },
};

// ---------------------------------------------------------------------------
// Key safety guard
// ---------------------------------------------------------------------------

/**
 * Returns true iff `k` is safe to interpolate into a Sanity filter path
 * (`[_key=="<k>"]`). Only alphanumeric characters and underscores are allowed.
 *
 * Every place a doc-derived `_key` is interpolated in buildPatchSet MUST call
 * this first and skip the item if it returns false.
 */
export function isSafeKey(k: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(k);
}

// ---------------------------------------------------------------------------
// buildSectionList — replaces the inline enrichedSections block in page.tsx
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = Record<string, any>;

/**
 * Builds an ordered list of section descriptors from the live doc, one entry
 * per section INSTANCE in `doc.sections` array order. Uses `_type` to look up
 * the field template and `_key` as the stable instance id.
 *
 * This is the authoritative display list for the editor form. Sections not
 * present in the doc are omitted. Multiple instances of the same _type each
 * get their own entry with independent field keys.
 */
export function buildSectionList(doc: AnyDoc): SectionDef[] {
  if (!Array.isArray(doc?.sections)) return [];

  const result: SectionDef[] = [];

  for (const section of doc.sections as Array<AnyDoc>) {
    const sectionKey: string | undefined = section._key;
    const sectionType: string | undefined = section._type;

    if (!sectionKey || !sectionType) continue;

    const template = sectionTemplates[sectionType];
    if (!template) continue; // unknown type — skip silently

    // Build static field defs with instance-scoped keys.
    const staticFields: FieldDef[] = template.fields.map((f) => ({
      key: `sec.${sectionKey}.${f.relKey}`,
      label: f.label,
      control: f.control,
      schema: f.schema,
      placeholder: f.placeholder,
    }));

    // Generate dynamic sub-item fields per section type.
    const dynamicFields: FieldDef[] = [];

    if (sectionType === 'bsServicesSection' && Array.isArray(section.services)) {
      section.services.forEach((card: AnyDoc, i: number) => {
        if (!card._key) return;
        const k: string = card._key;
        dynamicFields.push(
          { key: `sec.${sectionKey}.card.${k}.title`, label: `Service ${i + 1} title`, control: 'input', schema: shortTextOpt },
          { key: `sec.${sectionKey}.card.${k}.description`, label: `Service ${i + 1} description`, control: 'textarea', schema: mediumTextOpt },
        );
      });
    }

    if (sectionType === 'bsAboutSection' && Array.isArray(section.stats)) {
      section.stats.forEach((stat: AnyDoc, i: number) => {
        if (!stat._key) return;
        const k: string = stat._key;
        dynamicFields.push(
          { key: `sec.${sectionKey}.stat.${k}.value`, label: `Stat ${i + 1} value`, control: 'input', schema: statValue, placeholder: 'e.g. 15+ or 2,400' },
          { key: `sec.${sectionKey}.stat.${k}.label`, label: `Stat ${i + 1} label`, control: 'input', schema: shortTextOpt, placeholder: 'e.g. Years in business' },
        );
      });
    }

    if (sectionType === 'bsProcessSection' && Array.isArray(section.steps)) {
      section.steps.forEach((step: AnyDoc, i: number) => {
        if (!step._key) return;
        const k: string = step._key;
        dynamicFields.push(
          { key: `sec.${sectionKey}.step.${k}.title`, label: `Step ${i + 1} title`, control: 'input', schema: shortTextOpt },
          { key: `sec.${sectionKey}.step.${k}.description`, label: `Step ${i + 1} description`, control: 'textarea', schema: mediumTextOpt },
        );
      });
    }

    if (sectionType === 'bsFooterSection' && Array.isArray(section.columns)) {
      section.columns.forEach((col: AnyDoc, ci: number) => {
        if (!col._key) return;
        const ck: string = col._key;
        dynamicFields.push(
          { key: `sec.${sectionKey}.col.${ck}.heading`, label: `Column ${ci + 1} heading`, control: 'input', schema: shortTextOpt },
        );
        if (Array.isArray(col.links)) {
          col.links.forEach((link: AnyDoc, li: number) => {
            if (!link._key) return;
            const lk: string = link._key;
            dynamicFields.push(
              { key: `sec.${sectionKey}.col.${ck}.link.${lk}.label`, label: `Column ${ci + 1} link ${li + 1} label`, control: 'input', schema: shortTextOpt },
              { key: `sec.${sectionKey}.col.${ck}.link.${lk}.href`, label: `Column ${ci + 1} link ${li + 1} URL`, control: 'input', schema: ctaHref, placeholder: '#anchor or https://...' },
            );
          });
        }
      });
    }

    result.push({
      sectionType,
      sectionKey,
      label: template.label,
      fields: [...staticFields, ...dynamicFields],
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// extractFormValues — prefill the form from the live doc
// ---------------------------------------------------------------------------

/**
 * Extracts all editable values from the doc into a flat string map keyed by
 * the form field name. Missing fields are absent from the map (not empty
 * strings) so controlled inputs show the live value.
 *
 * Form keys for section fields use the instance-scoped scheme:
 *   'sec.<sectionKey>.<relPath>'
 *   'sec.<sectionKey>.card.<itemKey>.title'  etc.
 *
 * The output aligns 1:1 with the field keys produced by buildSectionList().
 */
export function extractFormValues(doc: AnyDoc): Record<string, string> {
  const out: Record<string, string> = {};

  function set(k: string, v: unknown) {
    if (v != null && v !== '') out[k] = String(v);
  }

  // Top-level fields.
  set('navCta.label', doc?.navCta?.label);
  set('navCta.href', doc?.navCta?.href);
  set('seo.metaTitle', doc?.seo?.metaTitle);
  set('seo.metaDescription', doc?.seo?.metaDescription);

  // Iterate sections in doc array order.
  if (!Array.isArray(doc?.sections)) return out;

  for (const section of doc.sections as Array<AnyDoc>) {
    const sectionKey: string | undefined = section._key;
    const sectionType: string | undefined = section._type;

    if (!sectionKey || !sectionType) continue;
    if (!sectionTemplates[sectionType]) continue;

    const sk = sectionKey; // alias for brevity

    switch (sectionType) {
      case 'bsHeroSection':
        set(`sec.${sk}.eyebrow`, section.eyebrow);
        set(`sec.${sk}.headline`, section.headline);
        set(`sec.${sk}.highlight`, section.highlight);
        set(`sec.${sk}.subhead`, section.subhead);
        set(`sec.${sk}.primaryCta.label`, section.primaryCta?.label);
        set(`sec.${sk}.primaryCta.href`, section.primaryCta?.href);
        set(`sec.${sk}.primaryCta.style`, section.primaryCta?.style);
        set(`sec.${sk}.secondaryCta.label`, section.secondaryCta?.label);
        set(`sec.${sk}.secondaryCta.href`, section.secondaryCta?.href);
        set(`sec.${sk}.secondaryCta.style`, section.secondaryCta?.style);
        break;

      case 'bsServicesSection':
        set(`sec.${sk}.eyebrow`, section.eyebrow);
        set(`sec.${sk}.heading`, section.heading);
        set(`sec.${sk}.subhead`, section.subhead);
        if (Array.isArray(section.services)) {
          for (const card of section.services as Array<AnyDoc>) {
            if (!card._key) continue;
            const k: string = card._key;
            set(`sec.${sk}.card.${k}.title`, card.title);
            set(`sec.${sk}.card.${k}.description`, card.description);
          }
        }
        break;

      case 'bsAboutSection':
        set(`sec.${sk}.eyebrow`, section.eyebrow);
        set(`sec.${sk}.heading`, section.heading);
        set(`sec.${sk}.body`, section.body);
        set(`sec.${sk}.cta.label`, section.cta?.label);
        set(`sec.${sk}.cta.href`, section.cta?.href);
        if (Array.isArray(section.stats)) {
          for (const stat of section.stats as Array<AnyDoc>) {
            if (!stat._key) continue;
            const k: string = stat._key;
            set(`sec.${sk}.stat.${k}.value`, stat.value);
            set(`sec.${sk}.stat.${k}.label`, stat.label);
          }
        }
        break;

      case 'bsProcessSection':
        set(`sec.${sk}.eyebrow`, section.eyebrow);
        set(`sec.${sk}.heading`, section.heading);
        if (Array.isArray(section.steps)) {
          for (const step of section.steps as Array<AnyDoc>) {
            if (!step._key) continue;
            const k: string = step._key;
            set(`sec.${sk}.step.${k}.title`, step.title);
            set(`sec.${sk}.step.${k}.description`, step.description);
          }
        }
        break;

      case 'bsReviewsSection':
        set(`sec.${sk}.eyebrow`, section.eyebrow);
        set(`sec.${sk}.heading`, section.heading);
        // reviews[] references are BLOCKED.
        break;

      case 'bsContactSection':
        set(`sec.${sk}.heading`, section.heading);
        set(`sec.${sk}.subhead`, section.subhead);
        set(`sec.${sk}.address.street`, section.address?.street);
        set(`sec.${sk}.address.city`, section.address?.city);
        set(`sec.${sk}.address.state`, section.address?.state);
        set(`sec.${sk}.address.zip`, section.address?.zip);
        set(`sec.${sk}.address.hours`, section.address?.hours);
        set(`sec.${sk}.address.serviceArea`, section.address?.serviceArea);
        set(`sec.${sk}.formLabels.name`, section.formLabels?.name);
        set(`sec.${sk}.formLabels.phone`, section.formLabels?.phone);
        set(`sec.${sk}.formLabels.email`, section.formLabels?.email);
        set(`sec.${sk}.formLabels.message`, section.formLabels?.message);
        set(`sec.${sk}.formLabels.submit`, section.formLabels?.submit);
        break;

      case 'bsUgcSection':
        set(`sec.${sk}.heading`, section.heading);
        set(`sec.${sk}.subhead`, section.subhead);
        break;

      case 'bsFooterSection':
        set(`sec.${sk}.tagline`, section.tagline);
        set(`sec.${sk}.legal`, section.legal);
        if (Array.isArray(section.columns)) {
          for (const col of section.columns as Array<AnyDoc>) {
            if (!col._key) continue;
            const ck: string = col._key;
            set(`sec.${sk}.col.${ck}.heading`, col.heading);
            if (Array.isArray(col.links)) {
              for (const link of col.links as Array<AnyDoc>) {
                if (!link._key) continue;
                const lk: string = link._key;
                set(`sec.${sk}.col.${ck}.link.${lk}.label`, link.label);
                set(`sec.${sk}.col.${ck}.link.${lk}.href`, link.href);
              }
            }
          }
        }
        break;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Dynamic sub-item zod schemas (matched via wildcard patterns on relative paths)
// ---------------------------------------------------------------------------

/**
 * Wildcard schemas keyed by relative path pattern (after the sec.<key>. prefix).
 * '*' matches any single path segment (_key token).
 */
const dynamicFieldSchemas: Record<string, z.ZodTypeAny> = {
  'card.*.title': shortTextOpt,
  'card.*.description': mediumTextOpt,
  'stat.*.value': statValue,
  'stat.*.label': shortTextOpt,
  'step.*.title': shortTextOpt,
  'step.*.description': mediumTextOpt,
  'col.*.heading': shortTextOpt,
  'col.*.link.*.label': shortTextOpt,
  'col.*.link.*.href': ctaHref,
};

/**
 * Returns the zod schema for a form field key.
 *
 * Top-level keys (no 'sec.' prefix) look up from topLevelFields.
 * Section keys ('sec.<sectionKey>.<relPath>') strip the prefix, then match
 * the static template fields for the section's _type, then fall through to
 * wildcard dynamic patterns for sub-item fields.
 *
 * The _type is resolved via the supplied key-to-type map. If the map is
 * absent or the type is unknown, falls through to wildcard matching only.
 */
export function schemaForKey(key: string, keyTypeMap?: Record<string, string>): z.ZodTypeAny {
  // Top-level fields.
  const topField = topLevelFields.find((f) => f.key === key);
  if (topField) return topField.schema;

  // Section fields must start with 'sec.'.
  if (!key.startsWith('sec.')) {
    return z.never({ message: `Unrecognised field key: '${key}'` });
  }

  // Strip 'sec.' prefix, then extract the sectionKey and the relative path.
  const withoutPrefix = key.slice('sec.'.length); // '<sectionKey>.<relPath>'
  const firstDot = withoutPrefix.indexOf('.');
  if (firstDot === -1) {
    return z.never({ message: `Unrecognised field key: '${key}'` });
  }
  const sectionKey = withoutPrefix.slice(0, firstDot);
  const relPath = withoutPrefix.slice(firstDot + 1);

  // Try to resolve the section's _type from the map.
  const sectionType = keyTypeMap?.[sectionKey];
  if (sectionType) {
    const template = sectionTemplates[sectionType];
    if (template) {
      const tField = template.fields.find((f) => f.relKey === relPath);
      if (tField) return tField.schema;
    }
  }

  // Match wildcard dynamic patterns on the relative path.
  const parts = relPath.split('.');

  // card.*.title / card.*.description
  if (parts[0] === 'card' && parts.length === 3) {
    const pattern = `card.*.${parts[2]}`;
    if (dynamicFieldSchemas[pattern]) return dynamicFieldSchemas[pattern]!;
  }
  // stat.*.value / stat.*.label
  if (parts[0] === 'stat' && parts.length === 3) {
    const pattern = `stat.*.${parts[2]}`;
    if (dynamicFieldSchemas[pattern]) return dynamicFieldSchemas[pattern]!;
  }
  // step.*.title / step.*.description
  if (parts[0] === 'step' && parts.length === 3) {
    const pattern = `step.*.${parts[2]}`;
    if (dynamicFieldSchemas[pattern]) return dynamicFieldSchemas[pattern]!;
  }
  // col.*.heading
  if (parts[0] === 'col' && parts.length === 3 && parts[2] === 'heading') {
    return dynamicFieldSchemas['col.*.heading']!;
  }
  // col.*.link.*.label / col.*.link.*.href
  if (parts[0] === 'col' && parts[2] === 'link' && parts.length === 5) {
    const pattern = `col.*.link.*.${parts[4]}`;
    if (dynamicFieldSchemas[pattern]) return dynamicFieldSchemas[pattern]!;
  }

  // Unknown key: hard-reject.
  return z.never({ message: `Unrecognised field key: '${key}'` });
}

// ---------------------------------------------------------------------------
// buildPatchSet — maps validated form values to Sanity granular paths
// ---------------------------------------------------------------------------

/**
 * Takes validated form values (already zod-parsed) and the current doc
 * (to resolve sub-array `_key`s), and returns a `patchSet` object whose
 * keys are Sanity dot-notation paths suitable for `.patch().set(patchSet)`.
 *
 * Form key `sec.<sectionKey>.<relPath>` resolves to:
 *   `sections[_key=="<sectionKey>"].<relPath>`
 *
 * Sub-item form key `sec.<sectionKey>.card.<itemKey>.title` resolves to:
 *   `sections[_key=="<sectionKey>"].services[_key=="<itemKey>"].title`
 *
 * Security: only emits paths for sections ACTUALLY present in the doc,
 * applies isSafeKey() to both sectionKey and all sub-item keys, and only
 * produces paths that correspond to a template field or allowed wildcard.
 */
export function buildPatchSet(
  doc: AnyDoc,
  formValues: Record<string, string>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  function emit(sanityPath: string, value: string | undefined) {
    if (value === undefined) return;
    patch[sanityPath] = value.trim();
  }

  // Top-level fields (same path as key, no section filter).
  for (const field of topLevelFields) {
    const value = formValues[field.key];
    if (value !== undefined) emit(field.key, value);
  }

  // Build a lookup: sectionKey -> section object (for existence check + sub-array reads).
  const sectionByKey = new Map<string, AnyDoc>();
  if (Array.isArray(doc?.sections)) {
    for (const s of doc.sections as Array<AnyDoc>) {
      if (s._key) sectionByKey.set(String(s._key), s);
    }
  }

  // Process section-scoped form values.
  for (const [formKey, value] of Object.entries(formValues)) {
    if (!formKey.startsWith('sec.')) continue;

    const withoutPrefix = formKey.slice('sec.'.length);
    const firstDot = withoutPrefix.indexOf('.');
    if (firstDot === -1) continue;

    const sectionKey = withoutPrefix.slice(0, firstDot);
    const relPath = withoutPrefix.slice(firstDot + 1);

    // Security: validate the section key and confirm the section exists in doc.
    if (!isSafeKey(sectionKey)) continue;
    const section = sectionByKey.get(sectionKey);
    if (!section) continue;

    const sectionType: string | undefined = section._type;
    if (!sectionType || !sectionTemplates[sectionType]) continue;

    // Route by relative path structure.
    const parts = relPath.split('.');

    if (parts[0] === 'card' && parts.length === 3) {
      // sec.<sk>.card.<itemKey>.<field>
      // Length === 3 guarantees indices 1 and 2 exist.
      const itemKey = parts[1] as string;
      const fieldName = parts[2] as string;
      if (!isSafeKey(itemKey)) continue;
      // Map 'services section' card -> doc sub-array is 'services'
      emit(
        `sections[_key=="${sectionKey}"].services[_key=="${itemKey}"].${fieldName}`,
        value,
      );
    } else if (parts[0] === 'stat' && parts.length === 3) {
      // sec.<sk>.stat.<itemKey>.<field>
      const itemKey = parts[1] as string;
      const fieldName = parts[2] as string;
      if (!isSafeKey(itemKey)) continue;
      emit(
        `sections[_key=="${sectionKey}"].stats[_key=="${itemKey}"].${fieldName}`,
        value,
      );
    } else if (parts[0] === 'step' && parts.length === 3) {
      // sec.<sk>.step.<itemKey>.<field>
      const itemKey = parts[1] as string;
      const fieldName = parts[2] as string;
      if (!isSafeKey(itemKey)) continue;
      emit(
        `sections[_key=="${sectionKey}"].steps[_key=="${itemKey}"].${fieldName}`,
        value,
      );
    } else if (parts[0] === 'col' && parts.length === 3 && parts[2] === 'heading') {
      // sec.<sk>.col.<colKey>.heading
      const colKey = parts[1] as string;
      if (!isSafeKey(colKey)) continue;
      emit(
        `sections[_key=="${sectionKey}"].columns[_key=="${colKey}"].heading`,
        value,
      );
    } else if (parts[0] === 'col' && parts[2] === 'link' && parts.length === 5) {
      // sec.<sk>.col.<colKey>.link.<linkKey>.<field>
      // Length === 5 guarantees indices 1, 3, 4 exist.
      const colKey = parts[1] as string;
      const linkKey = parts[3] as string;
      const fieldName = parts[4] as string;
      if (!isSafeKey(colKey) || !isSafeKey(linkKey)) continue;
      emit(
        `sections[_key=="${sectionKey}"].columns[_key=="${colKey}"].links[_key=="${linkKey}"].${fieldName}`,
        value,
      );
    } else {
      // Static scalar field — the relPath is directly a doc property path.
      // Validate it exists in the template before emitting.
      const template = sectionTemplates[sectionType];
      const known = template.fields.some((f) => f.relKey === relPath);
      if (!known) continue; // not in allowlist — silently skip (hard-block)
      emit(`sections[_key=="${sectionKey}"].${relPath}`, value);
    }
  }

  // Remove any undefined values (emit guards this, but be explicit).
  for (const k of Object.keys(patch)) {
    if (patch[k] === undefined) delete patch[k];
  }

  return patch;
}

// ---------------------------------------------------------------------------
// validateFormValues — run zod on all submitted values
// ---------------------------------------------------------------------------

/**
 * Validates all keys in `raw` against their zod schema.
 *
 * Accepts an optional `keyTypeMap` (sectionKey -> _type) for more precise
 * static-field schema resolution. When provided, section fields that match
 * a template definition use that schema; otherwise wildcard patterns are used.
 *
 * Returns `{ ok: true, values }` or `{ ok: false, errors }`.
 */
export function validateFormValues(
  raw: Record<string, string>,
  keyTypeMap?: Record<string, string>,
): {
  ok: true;
  values: Record<string, string>;
} | {
  ok: false;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const values: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw)) {
    const schema = schemaForKey(key, keyTypeMap);
    const result = schema.safeParse(value);
    if (!result.success) {
      errors[key] = result.error.errors[0]?.message ?? 'Invalid value';
    } else {
      values[key] = typeof result.data === 'string' ? result.data : (result.data ?? '');
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, values };
}

// ---------------------------------------------------------------------------
// Legacy per-item helpers (kept for any external callers; internally
// buildSectionList() inlines the same logic with instance-scoped keys).
// ---------------------------------------------------------------------------

/**
 * Returns per-service-card field descriptors for the section identified by
 * `sectionKey` in the doc.
 * @deprecated Use buildSectionList() which inlines this logic.
 */
export function serviceCardFields(doc: AnyDoc, sectionKey = 'services'): FieldDef[] {
  if (!Array.isArray(doc?.sections)) return [];
  const section = (doc.sections as Array<AnyDoc>).find((s) => s._key === sectionKey);
  if (!section || !Array.isArray(section.services)) return [];
  return section.services.flatMap((card: AnyDoc, i: number) => {
    if (!card._key) return [];
    const k: string = card._key;
    return [
      { key: `sec.${sectionKey}.card.${k}.title`, label: `Service ${i + 1} title`, control: 'input' as const, schema: shortTextOpt },
      { key: `sec.${sectionKey}.card.${k}.description`, label: `Service ${i + 1} description`, control: 'textarea' as const, schema: mediumTextOpt },
    ];
  });
}

/**
 * @deprecated Use buildSectionList() which inlines this logic.
 */
export function aboutStatFields(doc: AnyDoc, sectionKey = 'about'): FieldDef[] {
  if (!Array.isArray(doc?.sections)) return [];
  const section = (doc.sections as Array<AnyDoc>).find((s) => s._key === sectionKey);
  if (!section || !Array.isArray(section.stats)) return [];
  return section.stats.flatMap((stat: AnyDoc, i: number) => {
    if (!stat._key) return [];
    const k: string = stat._key;
    return [
      { key: `sec.${sectionKey}.stat.${k}.value`, label: `Stat ${i + 1} value`, control: 'input' as const, schema: statValue, placeholder: 'e.g. 15+ or 2,400' },
      { key: `sec.${sectionKey}.stat.${k}.label`, label: `Stat ${i + 1} label`, control: 'input' as const, schema: shortTextOpt, placeholder: 'e.g. Years in business' },
    ];
  });
}

/**
 * @deprecated Use buildSectionList() which inlines this logic.
 */
export function processStepFields(doc: AnyDoc, sectionKey = 'process'): FieldDef[] {
  if (!Array.isArray(doc?.sections)) return [];
  const section = (doc.sections as Array<AnyDoc>).find((s) => s._key === sectionKey);
  if (!section || !Array.isArray(section.steps)) return [];
  return section.steps.flatMap((step: AnyDoc, i: number) => {
    if (!step._key) return [];
    const k: string = step._key;
    return [
      { key: `sec.${sectionKey}.step.${k}.title`, label: `Step ${i + 1} title`, control: 'input' as const, schema: shortTextOpt },
      { key: `sec.${sectionKey}.step.${k}.description`, label: `Step ${i + 1} description`, control: 'textarea' as const, schema: mediumTextOpt },
    ];
  });
}

/**
 * @deprecated Use buildSectionList() which inlines this logic.
 */
export function footerColumnFields(doc: AnyDoc, sectionKey = 'footer'): FieldDef[] {
  if (!Array.isArray(doc?.sections)) return [];
  const section = (doc.sections as Array<AnyDoc>).find((s) => s._key === sectionKey);
  if (!section || !Array.isArray(section.columns)) return [];
  return section.columns.flatMap((col: AnyDoc, ci: number) => {
    if (!col._key) return [];
    const ck: string = col._key;
    const colFields: FieldDef[] = [
      { key: `sec.${sectionKey}.col.${ck}.heading`, label: `Column ${ci + 1} heading`, control: 'input', schema: shortTextOpt },
    ];
    if (Array.isArray(col.links)) {
      (col.links as Array<AnyDoc>).forEach((link: AnyDoc, li: number) => {
        if (!link._key) return;
        const lk: string = link._key;
        colFields.push(
          { key: `sec.${sectionKey}.col.${ck}.link.${lk}.label`, label: `Column ${ci + 1} link ${li + 1} label`, control: 'input', schema: shortTextOpt },
          { key: `sec.${sectionKey}.col.${ck}.link.${lk}.href`, label: `Column ${ci + 1} link ${li + 1} URL`, control: 'input', schema: ctaHref, placeholder: '#anchor or https://...' },
        );
      });
    }
    return colFields;
  });
}
