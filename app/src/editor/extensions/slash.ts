// The slash menu trigger (owner: WP4).
// WP0's factory adds nothing. Its owner replaces the body, keeping the signature that kit.ts calls.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';

export function slashExtensions(_host: EditorHost): Extensions {
  return [];
}
