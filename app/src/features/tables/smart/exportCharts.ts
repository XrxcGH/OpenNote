// The charts of a smart table as SVG text, for print and PDF (Phase 7). The print window calls this for each table of
// the page that keeps charts. The cells come from the table block as saved, so the charts show what the page shows,
// drawn from the same spec the table on the page uses. Colors come out as the light values, not as CSS variables,
// because the print document has no style sheet of tokens. Shapes stay vectors, and the chart keeps its title.
import { t } from '../../../strings/t';
import { tokens } from '../../../theme/tokens';
import type { SmartData } from './data';
import { readSmart } from './data';
import { chartSpec } from './chartSpec';
import { drawChart } from './draw';
import { appLocale } from './locale';
import { buildModel } from './model';

/** What the export needs of a table block: its columns, its rows of cell text, and its smart data. */
export interface ExportTable {
  readonly header: boolean;
  readonly columns: readonly { readonly id: string }[];
  readonly rows: readonly { readonly cells: Readonly<Record<string, string>> }[];
  readonly smart?: Readonly<Record<string, unknown>>;
}

export interface ExportedChart {
  readonly svg: string;
  readonly title: string;
}

const LIGHT: Readonly<Record<string, string>> = {
  'color-surface-page': tokens.color.light.surface.page,
  'color-text-secondary': tokens.color.light.text.secondary,
  'color-text-primary': tokens.color.light.text.primary,
};

/** The SVG text with each `var(--token)` replaced by the light value. */
function resolved(svg: string): string {
  return svg.replace(/var\(--([a-z-]+)\)/g, (_all, name: string) => LIGHT[name] ?? tokens.color.light.text.primary);
}

/** Draws every chart the table keeps, in order. A chart that reads a column the table no longer has is skipped. */
export async function exportTableCharts(table: ExportTable): Promise<readonly ExportedChart[]> {
  const smart: SmartData = readSmart({ smart: table.smart });
  if (smart.charts.length === 0) return [];
  const locale = appLocale();
  const ids = table.columns.map((column) => column.id);
  const texts = table.rows.map((row) => ids.map((id) => row.cells[id] ?? ''));
  const model = buildModel({ header: table.header, columnIds: ids, texts }, smart, locale);
  const out: ExportedChart[] = [];
  for (const chart of smart.charts) {
    const spec = chartSpec(model, chart, locale);
    if (!spec) continue;
    const names = spec.data.series.map((series) => series.name).join(', ');
    const title = chart.title ?? t('smart.chart.defaultTitle', { values: names, category: spec.data.xName });
    const drawing = await drawChart(spec);
    if (!drawing.getAttribute('xmlns')) drawing.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    out.push({ svg: resolved(drawing.outerHTML), title });
  }
  return out;
}
