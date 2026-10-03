// Arrow keys, Backspace, and Delete across block edges, and escalating to block selection (owner: WP4).
// WP0's factory adds nothing. Its owner replaces the body, keeping the signature that kit.ts calls.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';

export function crossBlockExtensions(_host: EditorHost): Extensions {
  return [];
}
