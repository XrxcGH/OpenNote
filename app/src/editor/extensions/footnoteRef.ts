// The footnote reference (SPEC 7.12): an inline atom `[^ID]` that names a note in its block's `data.notes`. It holds
// no text and can carry marks. The number it shows is not stored (R-FN-6); the footnotes lane draws it.
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
  renderHTML: ({ node }) => ['span', { 'data-footnote': String(node.attrs.id) }],
});

export function footnoteRefExtensions(_host: EditorHost): Extensions {
  return [FootnoteRef];
}
