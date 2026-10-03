// The text size mark, with Larger and Smaller (owner: WP4).
// WP0's factory returns the schema's own definition. Its owner replaces the body, keeping the signature.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';
import { TextSize } from '../schema/marks';

export function textSizeExtensions(_host: EditorHost): Extensions {
  return [TextSize];
}
