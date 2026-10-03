// List items: Enter, Backspace, task state, and the list keymap (owner: WP4).
// WP0's factory returns the schema's own definition. Its owner replaces the body, keeping the signature.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';
import { ListItem } from '../schema/nodes';

export function listItemExtensions(_host: EditorHost): Extensions {
  return [ListItem];
}
