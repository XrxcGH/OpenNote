// The spec of one chart of a smart table: which columns it reads, which rows are shown, and how it is titled
// (Phase 7). The table on the page and the print job both build charts from it.
import { buildChartSpec } from '../engine';
import type { ChartConfig, ChartSpec } from '../engine';
import { t } from '../../../strings/t';
import type { ChartSmart } from './data';
import type { appLocale } from './locale';
import type { SmartModel } from './model';

export function chartSpec(
  model: SmartModel,
  chart: ChartSmart,
  locale: ReturnType<typeof appLocale>,
): ChartSpec | null {
  const x = model.columnIds.indexOf(chart.x);
  const series = chart.series.map((id) => model.columnIds.indexOf(id)).filter((index) => index >= 0);
  if (x < 0 || series.length === 0) return null;
  const rows = chart.rows
    ? model.shown.filter((row) => row >= chart.rows!.from && row <= chart.rows!.to)
    : [...model.shown];
  const config: ChartConfig = {
    kind: chart.kind,
    x,
    series,
    ...(chart.aggregate ? { aggregate: chart.aggregate } : {}),
    ...(chart.stacked !== undefined ? { stacked: chart.stacked } : {}),
    ...(chart.patterns !== undefined ? { patterns: chart.patterns } : {}),
    ...(chart.title ? { title: chart.title } : {}),
    idPrefix: `c${chart.id.slice(-8)}`,
    otherLabel: t('smart.chart.other'),
  };
  return buildChartSpec(model.table, rows, config, locale);
}
