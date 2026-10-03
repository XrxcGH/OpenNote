// Math kept as source until Phase 10 renders it (owner: WP4).
// WP0's factory returns the schema's own definition. Its owner replaces the body, keeping the signature.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';
import { MathBlock, MathInline } from '../schema/nodes';

export function mathBlockExtensions(_host: EditorHost): Extensions {
  return [MathBlock];
}

export function mathInlineExtensions(_host: EditorHost): Extensions {
  return [MathInline];
}
