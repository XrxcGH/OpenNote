// What a new paragraph takes from the one it came from (text DESIGN.md 2.3). Enter gives the new paragraph a new
// element ID and a copy of the paragraph's formatting, except `breakBefore` and `dropCap`. A paragraph's attributes
// say so with `keepOnSplit` (attributes.ts), which Tiptap's split reads; a list item's split takes its attributes
// from here. Backspace and Delete keep the first paragraph's ID and formatting, which is what a join does already.
import { NOT_CARRIED, PARA_ATTRIBUTE_NAMES } from './attributes';

/** The paragraph formatting attributes a new paragraph or list item copies from the one Enter split. */
export function carriedParaAttrs(attrs: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const carried: Record<string, unknown> = {};
  for (const name of PARA_ATTRIBUTE_NAMES) {
    if (!(name in attrs)) continue;
    carried[name] = NOT_CARRIED.has(name) ? null : attrs[name];
  }
  return carried;
}
