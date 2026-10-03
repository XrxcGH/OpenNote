// Callouts: the title, folding, and the type menu (owner: WP4).
// WP0's factory returns the schema's own definition. Its owner replaces the body, keeping the signature.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';
import { Callout } from '../schema/nodes';

export function calloutExtensions(_host: EditorHost): Extensions {
  return [Callout];
}
