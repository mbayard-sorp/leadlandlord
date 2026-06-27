/**
 * BuildSell home-page section ruleset.
 *
 * Single source of truth for section type metadata and seed shapes.
 * Imported by packages/agents (the builder) and apps/customer-portal (the editor).
 * No upstream deps beyond this package.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BsSectionType =
  | 'bsHeroSection'
  | 'bsServicesSection'
  | 'bsAboutSection'
  | 'bsProcessSection'
  | 'bsReviewsSection'
  | 'bsContactSection'
  | 'bsUgcSection'
  | 'bsFooterSection';

export interface BsSectionRule {
  /** Human-readable label used in picker UI and error messages. */
  label: string;
  /**
   * Only one instance of this type may exist in the sections array.
   * Singletons are structural anchors (hero first, footer last, contact = lead form).
   */
  singleton: boolean;
  /** Customer may remove this section. Always false for singletons. */
  removable: boolean;
  /** Customer may add a new instance of this section via the picker. Always false for singletons. */
  addable: boolean;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const BS_SECTION_RULES: Record<BsSectionType, BsSectionRule> = {
  // Singletons: structural anchors; one each, never removable or duplicable.
  bsHeroSection: {
    label: 'Hero',
    singleton: true,
    removable: false,
    addable: false,
  },
  bsContactSection: {
    label: 'Contact',
    singleton: true,
    removable: false,
    addable: false,
  },
  bsFooterSection: {
    label: 'Footer',
    singleton: true,
    removable: false,
    addable: false,
  },

  // Repeatable: customers may add, remove, and duplicate these.
  bsServicesSection: {
    label: 'Services',
    singleton: false,
    removable: true,
    addable: true,
  },
  bsAboutSection: {
    label: 'About',
    singleton: false,
    removable: true,
    addable: true,
  },
  bsProcessSection: {
    label: 'How It Works',
    singleton: false,
    removable: true,
    addable: true,
  },
  bsReviewsSection: {
    label: 'Reviews',
    singleton: false,
    removable: true,
    addable: true,
  },
  bsUgcSection: {
    label: 'Social Gallery',
    singleton: false,
    removable: true,
    addable: true,
  },
} as const;

// ---------------------------------------------------------------------------
// Key generator
// ---------------------------------------------------------------------------

/** Generates a short alphanumeric/underscore key that passes isSafeKey (no dashes). */
function genSeedKey(prefix: string, index: number): string {
  return `${prefix}${index}`;
}

// ---------------------------------------------------------------------------
// Seed shapes
// ---------------------------------------------------------------------------

/**
 * Returns a fresh, minimal-but-valid block for the given section type.
 * No `_key` is included -- the caller assigns one (e.g. via genKey in the portal).
 * Nested sub-item `_key`s are stable seed values (prefixed + index).
 *
 * IMPORTANT: field names and nested `_type`s mirror the canonical block literals
 * in packages/agents/src/spec-site-builder/persist-sanity.ts:189-327 and the
 * Sanity schema in packages/sanity-schema/src/types/buildsell/.
 */
export function seedSection(type: BsSectionType): Record<string, unknown> {
  switch (type) {
    case 'bsHeroSection':
      return {
        _type: 'bsHeroSection',
        eyebrow: '',
        headline: '[HEADLINE]',
        highlight: '',
        subhead: '',
        showRating: true,
        badges: [],
        primaryCta: { _type: 'bsCtaButton', label: 'Get a Free Quote', href: '#contact', style: 'primary' },
        secondaryCta: { _type: 'bsCtaButton', label: 'Call Us', href: 'tel:', style: 'secondary' },
      };

    case 'bsServicesSection':
      return {
        _type: 'bsServicesSection',
        heading: 'Our Services',
        subhead: '',
        services: [
          {
            _key: genSeedKey('svc', 0),
            _type: 'bsServiceCard',
            icon: 'wrench',
            title: '[SERVICE NAME]',
            description: '[SERVICE DESCRIPTION]',
          },
        ],
      };

    case 'bsAboutSection':
      return {
        _type: 'bsAboutSection',
        heading: 'About Us',
        body: '[ABOUT BODY]',
        stats: [
          {
            _key: genSeedKey('st', 0),
            _type: 'bsStatItem',
            value: '[YEARS-IN-BUSINESS]+',
            label: 'Years in Business',
          },
        ],
      };

    case 'bsProcessSection':
      return {
        _type: 'bsProcessSection',
        heading: 'How It Works',
        steps: [
          {
            _key: genSeedKey('ps', 0),
            _type: 'bsProcessStep',
            icon: 'phone',
            title: 'Step 1',
            description: '[STEP DESCRIPTION]',
          },
        ],
      };

    case 'bsReviewsSection':
      return {
        _type: 'bsReviewsSection',
        heading: 'What Our Customers Say',
        showRating: true,
        // Reviews are references to bsReview docs; never seed with fake refs.
        reviews: [],
      };

    case 'bsContactSection':
      return {
        _type: 'bsContactSection',
        heading: 'Get In Touch',
        subhead: '',
        formEndpoint: '/api/bs/lead',
        showDetails: true,
        showMap: false,
        address: {
          _type: 'bsAddress',
          street: '',
          city: '',
          state: '',
          hours: '',
          serviceArea: '',
        },
      };

    case 'bsUgcSection':
      return {
        _type: 'bsUgcSection',
        heading: 'From Our Community',
        subhead: '',
        // UGC items are operator-curated; never seed with fake content.
        items: [],
      };

    case 'bsFooterSection':
      return {
        _type: 'bsFooterSection',
        tagline: '',
        legal: '',
        columns: [
          {
            _key: genSeedKey('fcol', 0),
            _type: 'bsFooterColumn',
            heading: 'Quick Links',
            links: [
              {
                _key: genSeedKey('fcl0_', 0),
                _type: 'bsNavLink',
                label: 'Services',
                href: '#services',
              },
            ],
          },
        ],
        social: [],
        legalLinks: [],
      };
  }
}
