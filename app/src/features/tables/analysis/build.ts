// Turns a grid of result text into the data of a new table block, with a chart when the result has one.
import { newId } from '../../../editor/ids';
import { serializeCell } from '../../../editor/markdown';
import type { MarkdownCache } from '../../../editor/markdown';
import { tableSchema } from '../../../editor/schema/schema';
import { newColumn, newRow } from '../../../editor/table/mapping';
import type { ChartKind } from '../engine';
import type { ChartSmart, SmartData } from '../smart/data';
import { smartPatch } from '../smart/data';

export interface Grid {
  /** Column titles. Without them the table has no header row, which suits a plain matrix. */
  head?: string[];
  rows: string[][];
  /** A format for each column, so a chart or a formula reads numbers; the rest are read from the cells. */
  types?: ('number' | 'text' | undefined)[];
  chart?: { kind: ChartKind; x: number; series: number[]; title: string; rows?: { from: number; to: number } };
}

export function gridToBlockData(grid: Grid, cache: MarkdownCache): Record<string, unknown> {
  const width = Math.max(grid.head?.length ?? 0, ...grid.rows.map((row) => row.length), 1);
  const columns = Array.from({ length: width }, () => newColumn());
  const cell = (text: string) => ({
    markdown: text === '' ? '' : serializeCell(tableSchema.nodes.paragraph.create(null, tableSchema.text(text)), cache),
  });
  const line = (texts: readonly string[]) => {
    const row = newRow(columns);
    columns.forEach((column, c) => {
      row.cells[column.id] = cell(texts[c] ?? '');
    });
    return row;
  };
  const rows = [...(grid.head ? [line(grid.head)] : []), ...grid.rows.map(line)];
  const smart: SmartData = { columns: {}, filters: [], charts: [] };
  grid.types?.forEach((type, c) => {
    if (type && columns[c]) smart.columns[columns[c].id] = { type };
  });
  if (grid.chart && columns[grid.chart.x]) {
    const chart: ChartSmart = {
      id: newId(),
      kind: grid.chart.kind,
      x: columns[grid.chart.x].id,
      series: grid.chart.series.map((c) => columns[c].id),
      title: grid.chart.title,
      ...(grid.chart.rows ? { rows: grid.chart.rows } : {}),
    };
    smart.charts.push(chart);
  }
  const extra = smartPatch(smart);
  return { header: grid.head !== undefined, columns, rows, ...(extra.smart ? extra : {}) };
}
