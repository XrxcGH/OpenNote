// A table block as a GFM table, with results where the sheet has formulas (format spec 6.3, ADR 0067). Markdown
// holds no spans, so a merged cell keeps its text in the anchor and the covered cells are empty. Of a cell's
// formatting only bold, italic, and strike come over, as Markdown writes them.

import { tableView } from './tableHtml';
import type { TableBlock } from './source';

/** How the table writes a cell: Markdown goes through the exporter's link rewrite, text is escaped. */
export interface CellWriter {
  readonly markdown: (markdown: string) => string;
  readonly text: (text: string) => string;
}

/** The GFM table of a block, or null for a table without columns. `onStale` hears of unusable cached results. */
export function tableMarkdown(block: TableBlock, write: CellWriter, onStale?: (id: string) => void): string | null {
  if (block.columns.length === 0) return null;
  const view = tableView(block);
  const cellOf = (r: number, c: number): string => {
    if (view.covered.has(`${r}:${c}`)) return '';
    const shown = view.cell(r, c);
    const text = shown.markdown === null ? write.text(shown.result ?? '') : write.markdown(shown.markdown);
    if (text === '') return '';
    const font = view.style(r, c)?.font;
    const bold = font?.weight === undefined ? font?.bold === true : font.weight >= 600;
    const strike = font?.strike === 'single' || font?.strike === 'double';
    let out = text;
    if (strike) out = `~~${out}~~`;
    if (font?.italic === true) out = `*${out}*`;
    if (bold) out = `**${out}**`;
    return out;
  };
  const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
  const rowOf = (r: number) => line(block.columns.map((_, c) => cellOf(r, c)));
  const indexes = block.rows.map((_, i) => i);
  const header = block.header && indexes.length > 0 ? rowOf(0) : line(block.columns.map(() => ''));
  const body = (block.header ? indexes.slice(1) : indexes).map(rowOf);
  const out = [header, line(block.columns.map(() => '---')), ...body].join('\n');
  if (view.stale) onStale?.(block.id);
  return out;
}
