// Code blocks: indenting, leaving the block, and the language attribute (owner: WP6).
// WP0's factory returns the schema's own definition. Its owner replaces the body, keeping the signature.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';
import { CodeBlock } from '../schema/nodes';

export function codeBlockExtensions(_host: EditorHost): Extensions {
  return [CodeBlock];
}
