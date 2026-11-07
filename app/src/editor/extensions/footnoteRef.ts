// The footnote reference (SPEC 7.12): an inline atom `[^ID]` that names a note in its block's `data.notes`. It holds
// no text and can carry marks. The number it shows is not stored (R-FN-6); the footnotes lane draws it.
// Until then the atom renders as an empty span that no one sees or hears. The footnotes lane adds three things.
// First, a node view or `::after` counter draws the number. Second, `role="doc-noteref"` (or a link) gives a name
// such as "Footnote 3". Third, a focus ring shows in forced colors. The static view needs the same.
import { Node } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';
import { isElementId } from '../schema/constants';

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
    {
      tag: 'span[data-footnote]',
      getAttrs: (element: HTMLElement) => (isElementId(element.getAttribute('data-footnote') ?? '') ? null : false),
    },
  ],
  // The footnotes lane's style sheet draws the number and its name, such as "Footnote 3" (editor/notes/view.ts).
  renderHTML: ({ node }) => ['span', { 'data-footnote': String(node.attrs.id), role: 'doc-noteref' }],
});

export function footnoteRefExtensions(_host: EditorHost): Extensions {
  return [FootnoteRef];
}
