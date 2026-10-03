// Shapes of the chart spec. A spec is plain data: the render layer loads Observable Plot, calls realizePlot, and
// draws. Nothing here imports Plot, so specs are built and tested without it.

import type { ChartData, ChartNote } from './data';
import type { PatternDef, PatternKind, SymbolName } from './palette';

/** One Plot mark as data. realizePlot turns it into `Plot[mark](data, options)`. */
export interface MarkSpec {
  mark: 'barY' | 'barX' | 'lineY' | 'areaY' | 'dot' | 'ruleY' | 'ruleX';
  data: readonly unknown[];
  options: Record<string, unknown>;
}

/** The options object for `Plot.plot`, with marks still as data. */
export interface PlotOptions {
  width: number;
  height: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  /** Inline styles that point Plot's own colors at design tokens. */
  style: Record<string, string>;
  x: Record<string, unknown>;
  y: Record<string, unknown>;
  fx?: Record<string, unknown>;
  fy?: Record<string, unknown>;
  color?: { domain: string[]; range: string[]; legend: false };
  marks: MarkSpec[];
}

/** How one series looks. Color alone tells the first three apart. Patterns, dashes, and shapes cover the rest. */
export interface SeriesStyle {
  name: string;
  slot: number;
  pen: string;
  /** A CSS variable for strokes and swatches. */
  color: string;
  /** What fills bars, areas, and slices: the color, or a pattern reference. */
  paint: string;
  pattern: PatternKind;
  dash: string | null;
  symbol: SymbolName;
}

export interface LegendEntry extends SeriesStyle {
  /** For a pie: the slice's share of the total, from 0 to 1. */
  share?: number;
}

export interface PieSlice {
  label: string;
  value: number;
  /** Share of the total, from 0 to 1. */
  share: number;
  /** Radians, from 12 o'clock and clockwise. */
  startAngle: number;
  endAngle: number;
  style: SeriesStyle;
}

export interface ChartSpec {
  kind: 'bar' | 'line' | 'area' | 'pie' | 'scatter';
  title?: string;
  width: number;
  height: number;
  data: ChartData;
  /** Patterns, dashes, and shapes are on: asked for, or from the fourth series. */
  patterns: boolean;
  patternDefs: PatternDef[];
  legend: LegendEntry[];
  /** Null for a pie, which Plot has no mark for. */
  plot: PlotOptions | null;
  pie: PieSlice[] | null;
  notes: ChartNote[];
}

/** The part of the Plot namespace that realizePlot uses, so tests can pass a fake. */
export type PlotMarks = Record<string, (data: readonly unknown[], options?: Record<string, unknown>) => unknown>;

/** Turns a spec's marks into real Plot marks. Call `Plot.plot(realizePlot(Plot, spec.plot))`. */
export function realizePlot(plot: PlotMarks, options: PlotOptions): Record<string, unknown> {
  return { ...options, marks: options.marks.map((m) => plot[m.mark](m.data, m.options)) };
}
