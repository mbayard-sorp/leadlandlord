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
 * Sub-array _key convention:
 *   Section _keys are stable literals (hero, services, about, process,
 *   reviews, contact, ugc, footer). Sub-item keys (svc0, st0, ps0, fcol0,
 *   fcl0_0…) are POSITIONAL — we ALWAYS read them from the current doc and
 *   never hardcode them.
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
const phoneOpt = noHtml(z.string().trim().max(40))
  .refine(
    (v) => v === '' || /^[0-9()+\-.\sxX]{7,}$/.test(v),
    'Enter a valid phone number, e.g. (555) 123-4567',
  )
  .optional()
  .or(z.literal(''));

// Friendly button-style choices. zod (`ctaStyle`) still accepts the legacy
// 'ghost' value, but the customer is only offered the two they understand.
const CTA_STYLE_OPTIONS: SelectOption[] = [
  { value: '', label: 'Default' },
  { value: 'primary', label: 'Solid button' },
  { value: 'secondary', label: 'Outline button' },
];

// ---------------------------------------------------------------------------
// Field descriptor types
// ---------------------------------------------------------------------------

export type ControlType = 'input' | 'textarea' | 'select';

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldDef {
  /** Unique key used as the HTML form field name. */
  key: string;
  label: string;
  control: ControlType;
  schema: z.ZodTypeAny;
  /** Optional placeholder text shown in the form control. */
  placeholder?: string;
  /** Plain-language helper text shown under the label (the "what is this" hint). */
  description?: string;
  /** Soft character limit — drives a live counter + the HTML maxLength attribute. */
  max?: number;
  /** Options for `control: 'select'`. */
  options?: SelectOption[];
  /** Marks the field as required in the UI (validation still lives in `schema`). */
  required?: boolean;
}

export interface SectionDef {
  /** Matches the section `_key` in Sanity (e.g. 'hero'). */
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
    description: field.description,
    max: field.max,
    options: field.options,
    required: field.required,
  };
}

export function toClientSection(section: SectionDef): ClientSectionDef {
  return {
    sectionKey: section.sectionKey,
    label: section.label,
    fields: section.fields.map(toClientField),
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Top-level fields (not inside sections[]). Split into two presentational
 * groups so the form can lead with content and tuck SEO away at the end.
 * Both are patched to top-level doc paths (see buildPatchSet / extractFormValues).
 */
export const businessFields: FieldDef[] = [
  {
    key: 'phone',
    label: 'Business phone number',
    control: 'input',
    schema: phoneOpt,
    placeholder: '(555) 123-4567',
    max: 40,
    description:
      'The number customers tap to call you. It powers the call button in your top menu, your main hero button, and your contact section.',
  },
  {
    key: 'navCta.label',
    label: 'Top menu button text',
    control: 'input',
    schema: shortTextOpt,
    placeholder: 'Call Now',
    max: 30,
    description: "The button in your top menu bar, e.g. 'Call Now' or 'Get a Quote.'",
  },
  {
    key: 'navCta.href',
    label: 'Top menu button link',
    control: 'input',
    schema: ctaHref,
    placeholder: '#contact',
    description:
      "Where the button takes visitors. Use #contact to jump to your contact form, or a tel: link like tel:5551234567 to start a call.",
  },
];

export const seoFields: FieldDef[] = [
  {
    key: 'seo.metaTitle',
    label: 'Title in Google results',
    control: 'input',
    schema: shortTextOpt,
    placeholder: 'Burbank Auto Doctor — Auto Repair in Burbank, CA',
    max: 60,
    description:
      'The clickable blue title shown when your site appears in a Google search. Include your business and city. Aim for 50-60 characters. Optional.',
  },
  {
    key: 'seo.metaDescription',
    label: 'Description in Google results',
    control: 'textarea',
    schema: mediumTextOpt,
    placeholder: 'Honest, expert auto repair in Burbank, CA. Upfront pricing and fast turnaround.',
    max: 160,
    description:
      'The short gray summary under your title in Google search. Describe what you do and where. About 150 characters. Optional.',
  },
];

/**
 * All top-level fields, flat — used by the validation + patch-building loops.
 */
export const topLevelFields: FieldDef[] = [...businessFields, ...seoFields];

/**
 * Section field definitions. The order here is the display order in the form.
 * The `sectionKey` must match the Sanity `_key` written by persist-sanity.ts.
 */
export const sectionDefs: SectionDef[] = [
  {
    sectionKey: 'hero',
    label: 'Hero (top of your site)',
    fields: [
      { key: 'hero.eyebrow', label: 'Small line above your headline', control: 'input', schema: shortTextOpt, max: 60, placeholder: "Burbank's trusted auto shop", description: 'A short phrase that sits above your big headline. Optional.' },
      { key: 'hero.headline', label: 'Main headline', control: 'input', schema: shortText, max: 120, required: true, description: 'The big bold text at the very top of your site — the first thing visitors read.' },
      { key: 'hero.highlight', label: 'Word to highlight in color', control: 'input', schema: shortTextOpt, max: 60, placeholder: 'trusted', description: 'Copy a word or phrase exactly as it appears in your headline above to make it stand out in color. Leave blank for none.' },
      { key: 'hero.subhead', label: 'Supporting sentence', control: 'textarea', schema: mediumTextOpt, max: 200, description: 'One or two sentences under your headline explaining what you do.' },
      { key: 'hero.imageAlt', label: 'Hero photo description', control: 'input', schema: shortTextOpt, max: 120, placeholder: 'Mechanic repairing a car engine', description: 'Describe the hero photo in a few words. Helps Google Images and visually-impaired visitors.' },
      { key: 'hero.primaryCta.label', label: 'Main button text', control: 'input', schema: shortTextOpt, max: 30, placeholder: 'Get a Free Quote', description: 'The text on your biggest, most prominent button.' },
      { key: 'hero.primaryCta.href', label: 'Main button link', control: 'input', schema: ctaHref, placeholder: '#contact', description: 'Where the button goes. Leave blank to auto-use your phone number, or use #contact to jump to your form.' },
      { key: 'hero.primaryCta.style', label: 'Main button style', control: 'select', schema: ctaStyle, options: CTA_STYLE_OPTIONS, description: 'Solid stands out most; outline is subtler.' },
      { key: 'hero.secondaryCta.label', label: 'Second button text', control: 'input', schema: shortTextOpt, max: 30, placeholder: 'See Our Work', description: 'Optional smaller button beside the main one.' },
      { key: 'hero.secondaryCta.href', label: 'Second button link', control: 'input', schema: ctaHref, placeholder: '#contact', description: 'Where it goes. Leave blank to jump to your contact section.' },
      { key: 'hero.secondaryCta.style', label: 'Second button style', control: 'select', schema: ctaStyle, options: CTA_STYLE_OPTIONS, description: 'Solid stands out most; outline is subtler.' },
    ],
  },
  {
    sectionKey: 'services',
    label: 'Services',
    fields: [
      { key: 'services.eyebrow', label: 'Small line above the title', control: 'input', schema: shortTextOpt, max: 60, description: 'Optional short phrase above your services title.' },
      { key: 'services.heading', label: 'Services section title', control: 'input', schema: shortText, max: 120, required: true, placeholder: 'What We Do', description: 'The title above your list of services.' },
      { key: 'services.subhead', label: 'Intro sentence', control: 'textarea', schema: mediumTextOpt, max: 200, description: 'Optional sentence introducing your services.' },
      // Per-card fields are generated dynamically in buildPatchSet / extractFormValues
      // using keys read from the doc. They follow the pattern:
      //   services.card.<_key>.title
      //   services.card.<_key>.description
    ],
  },
  {
    sectionKey: 'about',
    label: 'About',
    fields: [
      { key: 'about.eyebrow', label: 'Small line above the title', control: 'input', schema: shortTextOpt, max: 60, description: 'Optional short phrase above your About title.' },
      { key: 'about.heading', label: 'About section title', control: 'input', schema: shortTextOpt, max: 120, placeholder: 'About Our Shop', description: 'The title for your About section.' },
      { key: 'about.body', label: 'About your business', control: 'textarea', schema: longTextOpt, max: 1500, description: 'A paragraph or two about who you are, your experience, and why customers trust you.' },
      { key: 'about.imageAlt', label: 'About photo description', control: 'input', schema: shortTextOpt, max: 120, placeholder: 'Our team outside the shop', description: 'Describe the photo in your About section. Helps Google Images and screen readers.' },
      { key: 'about.cta.label', label: 'Button text', control: 'input', schema: shortTextOpt, max: 30, description: 'Optional button at the end of your About text.' },
      { key: 'about.cta.href', label: 'Button link', control: 'input', schema: ctaHref, placeholder: '#contact', description: 'Where the button goes.' },
      { key: 'about.cta.style', label: 'Button style', control: 'select', schema: ctaStyle, options: CTA_STYLE_OPTIONS, description: 'Solid stands out most; outline is subtler.' },
      // Per-stat fields: about.stat.<_key>.value / .label — generated dynamically
    ],
  },
  {
    sectionKey: 'process',
    label: 'How It Works',
    fields: [
      { key: 'process.eyebrow', label: 'Small line above the title', control: 'input', schema: shortTextOpt, max: 60, description: 'Optional short phrase above the section title.' },
      { key: 'process.heading', label: 'Section title', control: 'input', schema: shortText, max: 120, required: true, placeholder: 'How It Works', description: 'The title above your step-by-step list.' },
      // Per-step fields: process.step.<_key>.title / .description — generated dynamically
    ],
  },
  {
    sectionKey: 'reviews',
    label: 'Reviews',
    fields: [
      { key: 'reviews.eyebrow', label: 'Small line above the title', control: 'input', schema: shortTextOpt, max: 60, description: 'Optional short phrase above the section title.' },
      { key: 'reviews.heading', label: 'Reviews section title', control: 'input', schema: shortTextOpt, max: 120, placeholder: 'What Our Customers Say', description: 'Your reviews are pulled from Google and shown here automatically.' },
      // reviews[] references are BLOCKED — no per-review editing
    ],
  },
  {
    sectionKey: 'contact',
    label: 'Contact',
    fields: [
      { key: 'contact.heading', label: 'Contact section title', control: 'input', schema: shortTextOpt, max: 120, placeholder: 'Get in Touch', description: 'The title for your contact section.' },
      { key: 'contact.subhead', label: 'Intro sentence', control: 'textarea', schema: mediumTextOpt, max: 200, description: 'Optional sentence above your contact details.' },
      { key: 'contact.address.street', label: 'Street address', control: 'input', schema: shortTextOpt, max: 120, description: 'Used by Google for local search. Keep it exactly as it appears on your Google Maps listing.' },
      { key: 'contact.address.city', label: 'City', control: 'input', schema: shortTextOpt, max: 60 },
      { key: 'contact.address.state', label: 'State', control: 'input', schema: shortTextOpt, max: 40, placeholder: 'CA' },
      { key: 'contact.address.zip', label: 'ZIP code', control: 'input', schema: shortTextOpt, max: 12 },
      { key: 'contact.address.hours', label: 'Hours', control: 'input', schema: shortTextOpt, max: 120, placeholder: 'Mon–Sat 7am–6pm', description: "When you're open. Shown to customers and used for the 'Open now' label in Google." },
      { key: 'contact.address.serviceArea', label: 'Areas you serve', control: 'input', schema: shortTextOpt, max: 160, placeholder: 'Burbank, Glendale, Pasadena', description: 'Other nearby towns you serve, separated by commas. Helps you appear in nearby searches.' },
      { key: 'contact.formLabels.name', label: "Contact form — 'Name' field label", control: 'input', schema: shortTextOpt, max: 30, description: 'Wording on your contact form. Most people leave these as-is.' },
      { key: 'contact.formLabels.phone', label: "Contact form — 'Phone' field label", control: 'input', schema: shortTextOpt, max: 30 },
      { key: 'contact.formLabels.email', label: "Contact form — 'Email' field label", control: 'input', schema: shortTextOpt, max: 30 },
      { key: 'contact.formLabels.message', label: "Contact form — 'Message' field label", control: 'input', schema: shortTextOpt, max: 30 },
      { key: 'contact.formLabels.submit', label: 'Contact form — send button text', control: 'input', schema: shortTextOpt, max: 30 },
    ],
  },
  {
    sectionKey: 'ugc',
    label: 'Photo Gallery',
    fields: [
      { key: 'ugc.heading', label: 'Photo gallery title', control: 'input', schema: shortTextOpt, max: 120, placeholder: 'Our Recent Work', description: 'The title above your photo gallery.' },
      { key: 'ugc.subhead', label: 'Intro sentence', control: 'textarea', schema: mediumTextOpt, max: 200, description: 'Optional sentence introducing your gallery.' },
    ],
  },
  {
    sectionKey: 'faq',
    label: 'FAQ',
    fields: [
      { key: 'faq.eyebrow', label: 'Small line above the title', control: 'input', schema: shortTextOpt, max: 60, description: 'Optional short phrase above the FAQ title.' },
      { key: 'faq.heading', label: 'FAQ section title', control: 'input', schema: shortTextOpt, max: 120, placeholder: 'Frequently Asked Questions', description: 'Common questions and answers. Helps you appear in Google with an expandable FAQ.' },
      // Per-item fields: faq.item.<_key>.question / .answer — generated dynamically
    ],
  },
  {
    sectionKey: 'footer',
    label: 'Footer',
    fields: [
      { key: 'footer.tagline', label: 'Footer tagline', control: 'input', schema: shortTextOpt, max: 120, description: 'A short line about your business shown at the bottom of every page.' },
      { key: 'footer.legal', label: 'Copyright line', control: 'input', schema: shortTextOpt, max: 120, placeholder: '© 2026 Your Company. All rights reserved.', description: 'The small print at the very bottom of your site.' },
      // Per-column fields: footer.col.<_key>.heading — generated dynamically
      // Per-link fields:   footer.col.<_key>.link.<_key2>.label / .href — generated dynamically
    ],
  },
];

// ---------------------------------------------------------------------------
// Key safety guard (Fix 2 — defense-in-depth against path injection)
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
// Helpers for reading section data from the doc
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findSection(doc: Record<string, any>, sectionKey: string): Record<string, any> | null {
  const sections = doc?.sections;
  if (!Array.isArray(sections)) return null;
  return sections.find((s: { _key?: string }) => s._key === sectionKey) ?? null;
}

// ---------------------------------------------------------------------------
// extractFormValues — prefill the form from the live doc
// ---------------------------------------------------------------------------

/**
 * Extracts all editable values from the doc into a flat string map keyed by
 * the form field name. Missing fields are absent from the map (not empty
 * strings) so controlled inputs show the live value.
 *
 * Dynamic sub-array fields (per-card, per-stat, per-step, per-col, per-link)
 * use keys read from the doc at prefill time.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractFormValues(doc: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};

  function set(k: string, v: unknown) {
    if (v != null && v !== '') out[k] = String(v);
  }

  // Top-level
  set('phone', doc?.phone);
  set('navCta.label', doc?.navCta?.label);
  set('navCta.href', doc?.navCta?.href);
  set('seo.metaTitle', doc?.seo?.metaTitle);
  set('seo.metaDescription', doc?.seo?.metaDescription);

  // Hero
  const hero = findSection(doc, 'hero');
  if (hero) {
    set('hero.eyebrow', hero.eyebrow);
    set('hero.headline', hero.headline);
    set('hero.highlight', hero.highlight);
    set('hero.subhead', hero.subhead);
    set('hero.imageAlt', hero.imageAlt);
    set('hero.primaryCta.label', hero.primaryCta?.label);
    set('hero.primaryCta.href', hero.primaryCta?.href);
    set('hero.primaryCta.style', hero.primaryCta?.style);
    set('hero.secondaryCta.label', hero.secondaryCta?.label);
    set('hero.secondaryCta.href', hero.secondaryCta?.href);
    set('hero.secondaryCta.style', hero.secondaryCta?.style);
  }

  // Services
  const services = findSection(doc, 'services');
  if (services) {
    set('services.eyebrow', services.eyebrow);
    set('services.heading', services.heading);
    set('services.subhead', services.subhead);
    if (Array.isArray(services.services)) {
      for (const card of services.services) {
        if (!card._key) continue;
        set(`services.card.${card._key}.title`, card.title);
        set(`services.card.${card._key}.description`, card.description);
      }
    }
  }

  // About
  const about = findSection(doc, 'about');
  if (about) {
    set('about.eyebrow', about.eyebrow);
    set('about.heading', about.heading);
    set('about.body', about.body);
    set('about.imageAlt', about.imageAlt);
    set('about.cta.label', about.cta?.label);
    set('about.cta.href', about.cta?.href);
    set('about.cta.style', about.cta?.style);
    if (Array.isArray(about.stats)) {
      for (const stat of about.stats) {
        if (!stat._key) continue;
        set(`about.stat.${stat._key}.value`, stat.value);
        set(`about.stat.${stat._key}.label`, stat.label);
      }
    }
  }

  // Process
  const process = findSection(doc, 'process');
  if (process) {
    set('process.eyebrow', process.eyebrow);
    set('process.heading', process.heading);
    if (Array.isArray(process.steps)) {
      for (const step of process.steps) {
        if (!step._key) continue;
        set(`process.step.${step._key}.title`, step.title);
        set(`process.step.${step._key}.description`, step.description);
      }
    }
  }

  // Reviews (eyebrow + heading only — reviews[] blocked)
  const reviews = findSection(doc, 'reviews');
  if (reviews) {
    set('reviews.eyebrow', reviews.eyebrow);
    set('reviews.heading', reviews.heading);
  }

  // Contact
  const contact = findSection(doc, 'contact');
  if (contact) {
    set('contact.heading', contact.heading);
    set('contact.subhead', contact.subhead);
    set('contact.address.street', contact.address?.street);
    set('contact.address.city', contact.address?.city);
    set('contact.address.state', contact.address?.state);
    set('contact.address.zip', contact.address?.zip);
    set('contact.address.hours', contact.address?.hours);
    set('contact.address.serviceArea', contact.address?.serviceArea);
    set('contact.formLabels.name', contact.formLabels?.name);
    set('contact.formLabels.phone', contact.formLabels?.phone);
    set('contact.formLabels.email', contact.formLabels?.email);
    set('contact.formLabels.message', contact.formLabels?.message);
    set('contact.formLabels.submit', contact.formLabels?.submit);
  }

  // UGC (optional section)
  const ugc = findSection(doc, 'ugc');
  if (ugc) {
    set('ugc.heading', ugc.heading);
    set('ugc.subhead', ugc.subhead);
  }

  // FAQ (optional section)
  const faq = findSection(doc, 'faq');
  if (faq) {
    set('faq.eyebrow', faq.eyebrow);
    set('faq.heading', faq.heading);
    if (Array.isArray(faq.items)) {
      for (const item of faq.items) {
        if (!item._key) continue;
        set(`faq.item.${item._key}.question`, item.question);
        set(`faq.item.${item._key}.answer`, item.answer);
      }
    }
  }

  // Footer
  const footer = findSection(doc, 'footer');
  if (footer) {
    set('footer.tagline', footer.tagline);
    set('footer.legal', footer.legal);
    if (Array.isArray(footer.columns)) {
      for (const col of footer.columns) {
        if (!col._key) continue;
        set(`footer.col.${col._key}.heading`, col.heading);
        if (Array.isArray(col.links)) {
          for (const link of col.links) {
            if (!link._key) continue;
            set(`footer.col.${col._key}.link.${link._key}.label`, link.label);
            set(`footer.col.${col._key}.link.${link._key}.href`, link.href);
          }
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Field-level zod schemas for dynamic sub-array items
// ---------------------------------------------------------------------------

const dynamicFieldSchemas: Record<string, z.ZodTypeAny> = {
  'services.card.*.title': shortTextOpt,
  'services.card.*.description': mediumTextOpt,
  'about.stat.*.value': statValue,
  'about.stat.*.label': shortTextOpt,
  'process.step.*.title': shortTextOpt,
  'process.step.*.description': mediumTextOpt,
  'footer.col.*.heading': shortTextOpt,
  'footer.col.*.link.*.label': shortTextOpt,
  'footer.col.*.link.*.href': ctaHref,
  'faq.item.*.question': mediumTextOpt,
  'faq.item.*.answer': longTextOpt,
};

/**
 * Returns the zod schema for a form field key.
 * Static fields look up from sectionDefs; dynamic sub-array fields match
 * the wildcard patterns in `dynamicFieldSchemas`.
 */
export function schemaForKey(key: string): z.ZodTypeAny {
  // Look in top-level fields first.
  const topField = topLevelFields.find((f) => f.key === key);
  if (topField) return topField.schema;

  // Look in section defs.
  for (const section of sectionDefs) {
    const field = section.fields.find((f) => f.key === key);
    if (field) return field.schema;
  }

  // Match dynamic sub-array patterns.
  // Pattern: replace actual _key tokens with '*' and look up.
  //   services.card.svc0.title  ->  services.card.*.title
  //   about.stat.st0.value      ->  about.stat.*.value
  //   footer.col.fcol0.link.fcl0_0.href  ->  footer.col.*.link.*.href
  const parts = key.split('.');
  if (parts[0] === 'services' && parts[1] === 'card' && parts[3]) {
    const pattern = `services.card.*.${parts[3]}`;
    if (dynamicFieldSchemas[pattern]) return dynamicFieldSchemas[pattern];
  }
  if (parts[0] === 'about' && parts[1] === 'stat' && parts[3]) {
    const pattern = `about.stat.*.${parts[3]}`;
    if (dynamicFieldSchemas[pattern]) return dynamicFieldSchemas[pattern];
  }
  if (parts[0] === 'process' && parts[1] === 'step' && parts[3]) {
    const pattern = `process.step.*.${parts[3]}`;
    if (dynamicFieldSchemas[pattern]) return dynamicFieldSchemas[pattern];
  }
  if (parts[0] === 'footer' && parts[1] === 'col') {
    if (parts[3] === 'heading') return dynamicFieldSchemas['footer.col.*.heading']!;
    if (parts[3] === 'link' && parts[5]) {
      const pattern = `footer.col.*.link.*.${parts[5]}`;
      if (dynamicFieldSchemas[pattern]) return dynamicFieldSchemas[pattern];
    }
  }
  if (parts[0] === 'faq' && parts[1] === 'item' && parts[3]) {
    const pattern = `faq.item.*.${parts[3]}`;
    if (dynamicFieldSchemas[pattern]) return dynamicFieldSchemas[pattern];
  }

  // Unknown key: hard-reject. Callers (validateFormValues) surface this as a
  // validation error, not a silent pass-through.
  // A z.ZodType that always fails is returned so the existing validation loop
  // produces a proper { ok: false, errors } response without any special-casing.
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
 * Only emits paths for values that are present AND for sections that actually
 * exist in the doc. Never emits hard-blocked paths.
 *
 * The sub-array key resolution strategy:
 *   - Form keys for dynamic items use the real Sanity `_key` extracted at
 *     prefill time (e.g. `services.card.svc0.title`).
 *   - We convert `services.card.svc0.title` to the Sanity filter path:
 *     `sections[_key=="services"].services[_key=="svc0"].title`
 */
export function buildPatchSet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: Record<string, any>,
  formValues: Record<string, string>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = {};

  // Helper: only emit if the section exists in the doc.
  const hasSection = (key: string) => findSection(doc, key) !== null;

  function emit(sanityPath: string, value: string | undefined) {
    if (value === undefined) return;
    // Store empty string as undefined (omit) or the trimmed value.
    const trimmed = value.trim();
    // We still allow empty string to clear a field.
    patch[sanityPath] = trimmed;
  }

  // Top-level
  for (const field of topLevelFields) {
    const value = formValues[field.key];
    if (value === undefined) continue;
    // Convert dot-notation key to Sanity path (top-level fields are the same).
    emit(field.key, value);
  }

  // Hero
  if (hasSection('hero')) {
    const heroFields: Array<[string, string]> = [
      ['hero.eyebrow', `sections[_key=="hero"].eyebrow`],
      ['hero.headline', `sections[_key=="hero"].headline`],
      ['hero.highlight', `sections[_key=="hero"].highlight`],
      ['hero.subhead', `sections[_key=="hero"].subhead`],
      ['hero.imageAlt', `sections[_key=="hero"].imageAlt`],
      ['hero.primaryCta.label', `sections[_key=="hero"].primaryCta.label`],
      ['hero.primaryCta.href', `sections[_key=="hero"].primaryCta.href`],
      ['hero.primaryCta.style', `sections[_key=="hero"].primaryCta.style`],
      ['hero.secondaryCta.label', `sections[_key=="hero"].secondaryCta.label`],
      ['hero.secondaryCta.href', `sections[_key=="hero"].secondaryCta.href`],
      ['hero.secondaryCta.style', `sections[_key=="hero"].secondaryCta.style`],
    ];
    for (const [fk, sp] of heroFields) {
      emit(sp, formValues[fk]);
    }
  }

  // Services
  if (hasSection('services')) {
    const servicesSection = findSection(doc, 'services');
    emit(`sections[_key=="services"].eyebrow`, formValues['services.eyebrow']);
    emit(`sections[_key=="services"].heading`, formValues['services.heading']);
    emit(`sections[_key=="services"].subhead`, formValues['services.subhead']);

    if (servicesSection && Array.isArray(servicesSection.services)) {
      for (const card of servicesSection.services) {
        if (!card._key || !isSafeKey(card._key)) continue;
        const k = card._key;
        emit(
          `sections[_key=="services"].services[_key=="${k}"].title`,
          formValues[`services.card.${k}.title`],
        );
        emit(
          `sections[_key=="services"].services[_key=="${k}"].description`,
          formValues[`services.card.${k}.description`],
        );
      }
    }
  }

  // About
  if (hasSection('about')) {
    const aboutSection = findSection(doc, 'about');
    emit(`sections[_key=="about"].eyebrow`, formValues['about.eyebrow']);
    emit(`sections[_key=="about"].heading`, formValues['about.heading']);
    emit(`sections[_key=="about"].body`, formValues['about.body']);
    emit(`sections[_key=="about"].imageAlt`, formValues['about.imageAlt']);
    emit(`sections[_key=="about"].cta.label`, formValues['about.cta.label']);
    emit(`sections[_key=="about"].cta.href`, formValues['about.cta.href']);
    emit(`sections[_key=="about"].cta.style`, formValues['about.cta.style']);

    if (aboutSection && Array.isArray(aboutSection.stats)) {
      for (const stat of aboutSection.stats) {
        if (!stat._key || !isSafeKey(stat._key)) continue;
        const k = stat._key;
        emit(
          `sections[_key=="about"].stats[_key=="${k}"].value`,
          formValues[`about.stat.${k}.value`],
        );
        emit(
          `sections[_key=="about"].stats[_key=="${k}"].label`,
          formValues[`about.stat.${k}.label`],
        );
      }
    }
  }

  // Process
  if (hasSection('process')) {
    const processSection = findSection(doc, 'process');
    emit(`sections[_key=="process"].eyebrow`, formValues['process.eyebrow']);
    emit(`sections[_key=="process"].heading`, formValues['process.heading']);

    if (processSection && Array.isArray(processSection.steps)) {
      for (const step of processSection.steps) {
        if (!step._key || !isSafeKey(step._key)) continue;
        const k = step._key;
        emit(
          `sections[_key=="process"].steps[_key=="${k}"].title`,
          formValues[`process.step.${k}.title`],
        );
        emit(
          `sections[_key=="process"].steps[_key=="${k}"].description`,
          formValues[`process.step.${k}.description`],
        );
      }
    }
  }

  // Reviews (eyebrow + heading only)
  if (hasSection('reviews')) {
    emit(`sections[_key=="reviews"].eyebrow`, formValues['reviews.eyebrow']);
    emit(`sections[_key=="reviews"].heading`, formValues['reviews.heading']);
  }

  // Contact
  if (hasSection('contact')) {
    emit(`sections[_key=="contact"].heading`, formValues['contact.heading']);
    emit(`sections[_key=="contact"].subhead`, formValues['contact.subhead']);
    emit(`sections[_key=="contact"].address.street`, formValues['contact.address.street']);
    emit(`sections[_key=="contact"].address.city`, formValues['contact.address.city']);
    emit(`sections[_key=="contact"].address.state`, formValues['contact.address.state']);
    emit(`sections[_key=="contact"].address.zip`, formValues['contact.address.zip']);
    emit(`sections[_key=="contact"].address.hours`, formValues['contact.address.hours']);
    emit(`sections[_key=="contact"].address.serviceArea`, formValues['contact.address.serviceArea']);
    emit(`sections[_key=="contact"].formLabels.name`, formValues['contact.formLabels.name']);
    emit(`sections[_key=="contact"].formLabels.phone`, formValues['contact.formLabels.phone']);
    emit(`sections[_key=="contact"].formLabels.email`, formValues['contact.formLabels.email']);
    emit(`sections[_key=="contact"].formLabels.message`, formValues['contact.formLabels.message']);
    emit(`sections[_key=="contact"].formLabels.submit`, formValues['contact.formLabels.submit']);
  }

  // UGC (optional section — only emit if present in doc)
  if (hasSection('ugc')) {
    emit(`sections[_key=="ugc"].heading`, formValues['ugc.heading']);
    emit(`sections[_key=="ugc"].subhead`, formValues['ugc.subhead']);
  }

  // FAQ (optional section)
  if (hasSection('faq')) {
    const faqSection = findSection(doc, 'faq');
    emit(`sections[_key=="faq"].eyebrow`, formValues['faq.eyebrow']);
    emit(`sections[_key=="faq"].heading`, formValues['faq.heading']);

    if (faqSection && Array.isArray(faqSection.items)) {
      for (const item of faqSection.items) {
        if (!item._key || !isSafeKey(item._key)) continue;
        const k = item._key;
        emit(
          `sections[_key=="faq"].items[_key=="${k}"].question`,
          formValues[`faq.item.${k}.question`],
        );
        emit(
          `sections[_key=="faq"].items[_key=="${k}"].answer`,
          formValues[`faq.item.${k}.answer`],
        );
      }
    }
  }

  // Footer
  if (hasSection('footer')) {
    const footerSection = findSection(doc, 'footer');
    emit(`sections[_key=="footer"].tagline`, formValues['footer.tagline']);
    emit(`sections[_key=="footer"].legal`, formValues['footer.legal']);

    if (footerSection && Array.isArray(footerSection.columns)) {
      for (const col of footerSection.columns) {
        if (!col._key || !isSafeKey(col._key)) continue;
        const ck = col._key;
        emit(
          `sections[_key=="footer"].columns[_key=="${ck}"].heading`,
          formValues[`footer.col.${ck}.heading`],
        );
        if (Array.isArray(col.links)) {
          for (const link of col.links) {
            if (!link._key || !isSafeKey(link._key)) continue;
            const lk = link._key;
            emit(
              `sections[_key=="footer"].columns[_key=="${ck}"].links[_key=="${lk}"].label`,
              formValues[`footer.col.${ck}.link.${lk}.label`],
            );
            emit(
              `sections[_key=="footer"].columns[_key=="${ck}"].links[_key=="${lk}"].href`,
              formValues[`footer.col.${ck}.link.${lk}.href`],
            );
          }
        }
      }
    }
  }

  // Remove undefined values from the patch (emit already handles this, but
  // be explicit to avoid accidentally nulling fields the customer didn't submit).
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
 * Returns `{ ok: true, values }` or `{ ok: false, errors }`.
 */
export function validateFormValues(raw: Record<string, string>): {
  ok: true;
  values: Record<string, string>;
} | {
  ok: false;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const values: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw)) {
    const schema = schemaForKey(key);
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
// Dynamic field metadata for form rendering
// ---------------------------------------------------------------------------

/**
 * Returns per-service-card field descriptors keyed from the doc.
 * The `key` is the form field name used by extractFormValues/buildPatchSet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serviceCardFields(doc: Record<string, any>): FieldDef[] {
  const services = findSection(doc, 'services');
  if (!services || !Array.isArray(services.services)) return [];
  return services.services.flatMap((card: { _key?: string }, i: number) => {
    if (!card._key) return [];
    const k = card._key;
    return [
      { key: `services.card.${k}.title`, label: `Service ${i + 1} title`, control: 'input' as const, schema: shortTextOpt },
      { key: `services.card.${k}.description`, label: `Service ${i + 1} description`, control: 'textarea' as const, schema: mediumTextOpt },
    ];
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function aboutStatFields(doc: Record<string, any>): FieldDef[] {
  const about = findSection(doc, 'about');
  if (!about || !Array.isArray(about.stats)) return [];
  return about.stats.flatMap((stat: { _key?: string }, i: number) => {
    if (!stat._key) return [];
    const k = stat._key;
    return [
      { key: `about.stat.${k}.value`, label: `Stat ${i + 1} value`, control: 'input' as const, schema: statValue, placeholder: 'e.g. 15+ or 2,400' },
      { key: `about.stat.${k}.label`, label: `Stat ${i + 1} label`, control: 'input' as const, schema: shortTextOpt, placeholder: 'e.g. Years in business' },
    ];
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function processStepFields(doc: Record<string, any>): FieldDef[] {
  const process = findSection(doc, 'process');
  if (!process || !Array.isArray(process.steps)) return [];
  return process.steps.flatMap((step: { _key?: string }, i: number) => {
    if (!step._key) return [];
    const k = step._key;
    return [
      { key: `process.step.${k}.title`, label: `Step ${i + 1} title`, control: 'input' as const, schema: shortTextOpt },
      { key: `process.step.${k}.description`, label: `Step ${i + 1} description`, control: 'textarea' as const, schema: mediumTextOpt },
    ];
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function footerColumnFields(doc: Record<string, any>): FieldDef[] {
  const footer = findSection(doc, 'footer');
  if (!footer || !Array.isArray(footer.columns)) return [];
  return footer.columns.flatMap((col: { _key?: string; links?: Array<{ _key?: string }> }, ci: number) => {
    if (!col._key) return [];
    const ck = col._key;
    const colFields: FieldDef[] = [
      { key: `footer.col.${ck}.heading`, label: `Column ${ci + 1} heading`, control: 'input', schema: shortTextOpt },
    ];
    if (Array.isArray(col.links)) {
      col.links.forEach((link: { _key?: string }, li: number) => {
        if (!link._key) return;
        const lk = link._key;
        colFields.push(
          { key: `footer.col.${ck}.link.${lk}.label`, label: `Column ${ci + 1} link ${li + 1} label`, control: 'input', schema: shortTextOpt },
          { key: `footer.col.${ck}.link.${lk}.href`, label: `Column ${ci + 1} link ${li + 1} URL`, control: 'input', schema: ctaHref, placeholder: '#anchor or https://...' },
        );
      });
    }
    return colFields;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function faqItemFields(doc: Record<string, any>): FieldDef[] {
  const faq = findSection(doc, 'faq');
  if (!faq || !Array.isArray(faq.items)) return [];
  return faq.items.flatMap((item: { _key?: string }, i: number) => {
    if (!item._key) return [];
    const k = item._key;
    return [
      { key: `faq.item.${k}.question`, label: `Question ${i + 1}`, control: 'input' as const, schema: mediumTextOpt, max: 200, placeholder: 'How long does a typical job take?' },
      { key: `faq.item.${k}.answer`, label: `Answer ${i + 1}`, control: 'textarea' as const, schema: longTextOpt, max: 600 },
    ];
  });
}
