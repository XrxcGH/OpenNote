// AutoCorrect while typing (owner: WP4).
// WP0's factory adds nothing. Its owner replaces the body, keeping the signature that kit.ts calls.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';

export function autocorrectExtensions(_host: EditorHost): Extensions {
  return [];
}
