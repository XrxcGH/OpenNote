// Foreign marks (R-INL-9): the tags of a later version, kept byte for byte through edits. The mark is inclusive, so
// text typed inside its range joins it, and the writer writes the stored tag back unchanged.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';
import { Foreign } from '../schema/marks';

export function foreignExtensions(_host: EditorHost): Extensions {
  return [Foreign];
}
