// The words of a selection, for the description a picture carries.
import type { ExportPage } from '../export/source';
import type { Selection } from './select';

/** The words of the selected text blocks, flattened and cut short: the description a Word picture carries. */
export function selectionText(page: ExportPage, selection: Selection, max = 600): string {
  const chosen = new Set(selection.blocks);
  const words = page.blocks
    .flatMap((b) => (b.type === 'text' && chosen.has(b.id) ? [b.markdown] : []))
    .join(' ')
    .replace(/[#*_`>[\]()!-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return words.length > max ? `${words.slice(0, max).trimEnd()}…` : words;
}
