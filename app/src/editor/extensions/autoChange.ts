// Automatic changes as their own undo step, with Backspace to take them back (owner: WP4).
// WP0's factory adds nothing. Its owner replaces the body, keeping the signature that kit.ts calls.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';

export function autoChangeExtensions(_host: EditorHost): Extensions {
  return [];
}
