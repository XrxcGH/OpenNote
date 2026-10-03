// Inline images inside text (owner: WP4).
// WP0's factory returns the schema's own definition. Its owner replaces the body, keeping the signature.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';
import { ImageNode } from '../schema/nodes';

export function imageExtensions(_host: EditorHost): Extensions {
  return [ImageNode];
}
