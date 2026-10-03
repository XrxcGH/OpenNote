// Google Docs' clipboard HTML (Phase 4 ARCHITECTURE.md sections 15.3 and 15.4): the whole paste is wrapped in a
// `<b id="docs-internal-guid-...">`, and formatting, highlights, and text colors live in inline styles.
import { removeAll, unwrap } from '../dom';
import { mapColors } from './colors';
import { dropFormattingAttributes, dropUnwanted, fixNestedLists, styleToTags } from './common';

/** Google Docs wraps the whole paste in `<b id="docs-internal-guid-...">` and puts formatting in inline styles. */
export function normalizeGoogleDocs(body: HTMLElement): void {
  dropUnwanted(body);
  body.querySelectorAll('[id^="docs-internal-guid-"]').forEach(unwrap);
  removeAll(body, 'br.Apple-interchange-newline');
  fixNestedLists(body);
  mapColors(body);
  styleToTags(body);
  dropFormattingAttributes(body);
}
