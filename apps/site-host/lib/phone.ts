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
