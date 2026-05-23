/**
 * Replace `{{phone}}` placeholder tokens with the tenant's tracking number.
 * Content Engine writes the placeholder in body copy / CTAs so the same MDX
 * works for every site without baking a literal number into Sanity (which
 * would break the moment the tracking number changes). Substitution happens
 * at render time, in every component that renders tenant MDX.
 */
export function substitutePhone(text: string, phone: string): string {
  if (!text.includes('{{')) return text;
  return text.replace(/\{\{\s*phone\s*\}\}/gi, phone);
}

/**
 * Deep-substitute `{{phone}}` across every string in a value (bundle, page,
 * faq, jsonld, etc.). Variant components and route ledes render many raw
 * string fields (hero subtitle, meta_description, derived FAQ answers) that
 * also carry the placeholder, so substituting only in the MDX components
 * leaves those fields showing the literal token. Applying this once per route
 * — where the tracking number is resolved — guarantees no field leaks `{{phone}}`.
 */
export function substituteBundlePhone<T>(value: T, phone: string): T {
  if (typeof value === 'string') {
    return substitutePhone(value, phone) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => substituteBundlePhone(v, phone)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = substituteBundlePhone(v, phone);
    }
    return out as T;
  }
  return value;
}
