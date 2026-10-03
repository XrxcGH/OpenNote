// Spelling error decorations from the page's spelling cache (owner: WP7).
// WP0's factory adds nothing. Its owner replaces the body, keeping the signature that kit.ts calls.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';

export function spellingRangesExtensions(_host: EditorHost): Extensions {
  return [];
}
