// The highlight mark and its colors (owner: WP4).
// WP0's factory returns the schema's own definition. Its owner replaces the body, keeping the signature.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';
import { Highlight } from '../schema/marks';

export function highlightExtensions(_host: EditorHost): Extensions {
  return [Highlight];
}
