// The chart spec builder: a table, the rows it shows, and a chart type become an Observable Plot options object
// with brand palette slots and color-blind patterns. It draws nothing. The render layer, loaded only when a page
// has a chart, calls `Plot.plot(realizePlot(Plot, spec.plot))`, or draws `spec.pie` itself.

import type { Locale } from '../locale';
import type { Column, Table } from '../model';
import { deriveChartData, type Aggregate, type ChartData, type ChartKind } from './data';
import { areaLayer, barLayer, lineLayer, scatterLayer, type Build, type Layer } from './marks';
import { MAX_SERIES, SLOTS, needsPatterns, patternDefs, slotColor, slotPaint } from './palette';
import { pieSlices } from './pie';
import type { ChartSpec, LegendEntry, PlotOptions, SeriesStyle } from './types';

export interface ChartConfig {
  kind: ChartKind;
  /** The x column index: categories, dates, or numbers along the axis, and the slice names of a pie. */
  x: number;
  /** Value column indices: one to seven, and exactly one for a pie. */
  series: readonly number[];
  aggregate?: Aggregate;
  /** Series stack instead of standing side by side (bar) or overlapping (area). Area stacks unless false. */
  stacked?: boolean;
  horizontal?: boolean;
  /** Always draw patterns and shapes, even for one to three series. */
  patterns?: boolean;
  title?: string;
  width?: number;
  height?: number;
  /** Scopes pattern ids, so two charts on a page never share a definition. */
  idPrefix?: string;
  /** The name of the last pie slice, which gathers the small ones. The interface supplies it. */
  otherLabel?: string;
}

export const DEFAULT_WIDTH = 640;
export const DEFAULT_HEIGHT = 360;
/** One bar per three units of plot width, so every bar stays readable. */
const UNITS_PER_BAR = 3;
const MARGIN = { top: 24, right: 26, bottom: 40, left: 56, leftHorizontal: 96 };

/** The chart's size and the room left for marks. */
interface Frame {
  width: number;
  height: number;
  marginLeft: number;
  plotWidth: number;
  plotHeight: number;
}

function frameFor(config: ChartConfig): Frame {
  const width = config.width ?? DEFAULT_WIDTH;
  const height = config.height ?? DEFAULT_HEIGHT;
  const marginLeft = config.horizontal && config.kind === 'bar' ? MARGIN.leftHorizontal : MARGIN.left;
  return {
    width,
    height,
    marginLeft,
    plotWidth: width - marginLeft - MARGIN.right,
    plotHeight: height - MARGIN.top - MARGIN.bottom,
  };
}

function styleFor(name: string, slot: number, patterns: boolean, prefix: string): SeriesStyle {
  const s = SLOTS[slot % MAX_SERIES];
  return {
    name,
    slot,
    pen: s.pen,
    color: slotColor(slot),
    paint: slotPaint(slot, patterns, prefix),
    pattern: s.pattern,
    dash: s.dash,
    symbol: s.symbol,
  };
}

/** Axis labels: compact numbers, and percent or currency when the series column says so. */
function valueFormat(column: Column | undefined, locale: Locale): (value: number) => string {
  const compact: Intl.NumberFormatOptions = { notation: 'compact', maximumFractionDigits: 2 };
  const options: Intl.NumberFormatOptions =
    column?.type === 'percent'
      ? { style: 'percent', maximumFractionDigits: 1 }
      : column?.type === 'currency'
        ? { ...compact, style: 'currency', currency: column.currency ?? locale.currency }
        : compact;
  const format = new Intl.NumberFormat(locale.tag, options);
  return (value) => format.format(value);
}

function layerFor(kind: ChartKind, build: Build): Layer {
  switch (kind) {
    case 'bar':
      return barLayer(build);
    case 'line':
      return lineLayer(build);
    case 'area':
      return areaLayer(build);
    default:
      return scatterLayer(build);
  }
}

function plotOptions(
  build: Build,
  kind: ChartKind,
  frame: Frame,
  valueColumn: Column | undefined,
  locale: Locale,
): PlotOptions {
  const { data } = build;
  const layer = layerFor(kind, build);
  const values = {
    label: data.series.length === 1 ? data.series[0].name : null,
    grid: true,
    // The value axis ends on a labelled tick, so the tallest bar or point stays under the top grid line.
    nice: true,
    tickFormat: valueFormat(valueColumn, locale),
  };
  const scaleType = kind === 'bar' ? 'band' : data.xKind === 'date' ? 'utc' : data.xKind === 'number' ? 'linear' : null;
  const categories = { label: data.xName, ...(scaleType ? { type: scaleType } : {}) };
  const [x, y] = build.horizontal ? [values, categories] : [categories, values];
  return {
    width: frame.width,
    height: frame.height,
    marginTop: MARGIN.top,
    marginRight: MARGIN.right,
    marginBottom: MARGIN.bottom,
    marginLeft: frame.marginLeft,
    style: { '--plot-background': 'var(--color-surface-page)', color: 'var(--color-text-secondary)' },
    ...layer.scales,
    x: { ...x, ...(layer.scales.x as object) },
    y: { ...y, ...(layer.scales.y as object) },
    marks: layer.marks,
  };
}

function legendFor(styles: SeriesStyle[], shares?: number[]): LegendEntry[] {
  return styles.map((style, i) => (shares ? { ...style, share: shares[i] } : style));
}

type Base = Pick<ChartSpec, 'kind' | 'title' | 'width' | 'height' | 'data' | 'notes'>;

function pieSpec(base: Base, patternsWanted: boolean, prefix: string): ChartSpec {
  const points = base.data.series[0]?.points ?? [];
  const patterns = needsPatterns(points.length, patternsWanted);
  const styles = points.map((p, i) => styleFor(String(p.x), i, patterns, prefix));
  const slices = pieSlices(points, styles);
  const slots = styles.map((s) => s.slot);
  const legend = legendFor(
    styles,
    slices.map((s) => s.share),
  );
  return {
    ...base,
    patterns,
    patternDefs: patterns ? patternDefs(slots, prefix) : [],
    legend,
    plot: null,
    pie: slices,
  };
}

/**
 * Builds the spec for a chart. `rows` are the row indices the table shows, in view order, from viewIndices,
 * so a filter or sort on the table changes the chart. The caller compares `spec.data` with the data it last
 * drew. Equal data needs no redraw, so sorting a table under a line chart costs the chart nothing.
 */
export function buildChartSpec(table: Table, rows: readonly number[], config: ChartConfig, locale: Locale): ChartSpec {
  const frame = frameFor(config);
  const horizontal = config.horizontal === true && config.kind === 'bar';
  const prefix = config.idPrefix ?? 'chart';
  const data: ChartData = deriveChartData(
    table,
    rows,
    {
      kind: config.kind,
      x: config.x,
      series: config.series.slice(0, config.kind === 'pie' ? 1 : MAX_SERIES),
      aggregate: config.aggregate,
      maxBars: Math.floor((horizontal ? frame.plotHeight : frame.plotWidth) / UNITS_PER_BAR),
      maxPoints: Math.max(3, Math.floor(frame.plotWidth)),
      otherLabel: config.otherLabel ?? 'Other',
    },
    locale,
  );
  const base: Base = {
    kind: config.kind,
    title: config.title,
    width: frame.width,
    height: frame.height,
    data,
    notes: data.notes,
  };
  if (config.kind === 'pie') return pieSpec(base, config.patterns === true, prefix);
  const patterns = needsPatterns(data.series.length, config.patterns === true);
  const styles = data.series.map((s, i) => styleFor(s.name, i, patterns, prefix));
  const build: Build = { data, styles, patterns, stacked: config.stacked ?? config.kind === 'area', horizontal };
  const valueColumn = table.columns[data.series[0]?.column];
  return {
    ...base,
    patterns,
    patternDefs: patterns
      ? patternDefs(
          styles.map((s) => s.slot),
          prefix,
        )
      : [],
    legend: styles.length > 1 ? legendFor(styles) : [],
    plot: plotOptions(build, config.kind, frame, valueColumn, locale),
    pie: null,
  };
}
