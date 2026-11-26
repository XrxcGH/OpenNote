// The font mark (R-MRK-1). The font picker and its commands come from the fonts lanes; this file keeps the mark's
// place in the kit, with the factory signature every mark extension has.
import type { Extensions } from '@tiptap/core';
import type { EditorHost } from '../host';
import { Font } from '../schema/marks';

export function fontExtensions(_host: EditorHost): Extensions {
  return [Font];
}
