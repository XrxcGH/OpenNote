// The footnote reference (SPEC 7.12): an inline atom `[^ID]` that names a note in its block's `data.notes`. It holds
// no text and can carry marks. The number it shows is not stored (R-FN-6); the footnotes lane draws it.
// The atom renders as an `a` with `role="doc-noteref"`: DPUB-ARIA allows that role on an anchor with an `href` but not on a span,
// and a role is what makes the reference a navigable thing for a screen reader. The number and its name, such as
// "Footnote 3", come from `::after` content with alternative text, which the page's style sheet sets for each
// reference (editor/notes/view.ts). A focus ring shows in forced colors. The static view renders the same element.
import { Node } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';
import { isElementId } from '../schema/constants';

/** The element ID of a note's list item in the notes area, which the reference's `href` points to. */
export const noteTarget = (id: string): string => `note-${id}`;

export const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({
    id: {
      default: '',
      rendered: false,
      parseHTML: (element: HTMLElement) => element.getAttribute('data-footnote') ?? '',
    },
  }),
  parseHTML: () => [
    // Older copies and exports hold a span.
    ...['a[data-footnote]', 'span[data-footnote]'].map((tag) => ({
      tag,
      getAttrs: (element: HTMLElement) => (isElementId(element.getAttribute('data-footnote') ?? '') ? null : false),
    })),
  ],
  renderHTML: ({ node }) => [
    'a',
    { 'data-footnote': String(node.attrs.id), role: 'doc-noteref', href: `#${noteTarget(String(node.attrs.id))}` },
  ],
});

export function footnoteRefExtensions(_host: EditorHost): Extensions {
  return [FootnoteRef];
}
