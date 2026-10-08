// Pasting into a smart table: what the clipboard holds becomes a typed table. The page's paste pipeline (Phase 4)
// calls tableFromClipboard after it has made the HTML inert, and calls tableFromText for a dropped CSV file.

import type { Locale } from '../locale';
import { parseDelimited, sniffDelimiter, type Delimiter } from './delimited';
import { parseHtmlTable } from './html';
import { buildPastedTable, type PasteResult } from './infer';

export { MAX_COLUMNS, MAX_ROWS, buildPastedTable, type PasteResult } from './infer';
export { parseDelimited, sniffDelimiter, stripBom, type Delimiter } from './delimited';
export { parseHtmlTable, type HtmlGrid, type PasteCell, type PasteSource } from './html';

export interface ClipboardInput {
  html?: string;
  text?: string;
}

/** A table from delimited text, or null when the text isn't grid-shaped. Pass a delimiter to skip the sniffing. */
export function tableFromText(text: string, locale: Locale, delimiter?: Delimiter): PasteResult | null {
  const found = delimiter ?? sniffDelimiter(text);
  if (!found) return null;
  const rows = parseDelimited(text, found).map((fields) => fields.map((field) => ({ text: field })));
  return rows.length === 0 ? null : buildPastedTable({ rows, source: 'delimited' }, locale);
}

/** A table from the clipboard: its HTML table when it has exactly one, else its text when that is grid-shaped. */
export function tableFromClipboard(input: ClipboardInput, locale: Locale): PasteResult | null {
  const grid = input.html ? parseHtmlTable(input.html) : null;
  if (grid) return buildPastedTable(grid, locale);
  return input.text ? tableFromText(input.text, locale) : null;
}
