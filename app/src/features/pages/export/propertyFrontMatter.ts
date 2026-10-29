// Page properties in front matter (A3-9). The page's own page.md lists them in a `properties:` block, written by the
// core (crates/core/src/format/readable/page_md.rs, `property_lines`). The Markdown export calls this helper so an
// exported file lists them the same way, for Obsidian, Hugo, Pandoc, and other apps that read front matter.
import { readFields, type Field } from '../../search';

/** The most fields listed, as the core lists. */
export const MAX_PROPERTIES = 64;

/** A YAML double-quoted string: JSON's escapes, plus the characters some YAML readers take as line breaks. */
export function yamlQuoted(text: string): string {
  return JSON.stringify(text).replace(
    /[\u007f-\u009f\u2028\u2029\ufeff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

const oneLine = (text: string): string => text.replace(/\r\n|[\r\n]/g, ' ');

function valueOf(field: Field): string {
  switch (field.type) {
    case 'checkbox':
      return field.value === true ? 'true' : 'false';
    case 'number':
      return typeof field.value === 'number' && Number.isFinite(field.value) ? String(field.value) : 'null';
    case 'page':
      return field.label ? yamlQuoted(oneLine(field.label)) : 'null';
    default:
      return typeof field.value === 'string' && field.value !== '' ? yamlQuoted(field.value) : 'null';
  }
}

/**
 * The `properties:` lines of front matter for a page's `view`, or none when it has no named fields. Each field is
 * `"Name": value`; a second field with the same name and fields without a name are left out.
 */
export function propertyFrontMatter(view: Record<string, unknown> | null | undefined): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const field of readFields(view).slice(0, MAX_PROPERTIES)) {
    const name = oneLine(field.name);
    if (name.trim() === '' || seen.has(name)) continue;
    seen.add(name);
    lines.push(`  ${yamlQuoted(name)}: ${valueOf(field)}`);
  }
  return lines.length === 0 ? [] : ['properties:', ...lines];
}
