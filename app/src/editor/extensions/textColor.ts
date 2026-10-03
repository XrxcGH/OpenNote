// The text color mark (owner: WP4).
// WP0's factory returns the schema's own definition. Its owner replaces the body, keeping the signature.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';
import { TextColor } from '../schema/marks';

export function textColorExtensions(_host: EditorHost): Extensions {
  return [TextColor];
}
