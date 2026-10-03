// Chart specs from tables. See spec.ts for the entry point, buildChartSpec.

export { buildChartSpec, DEFAULT_HEIGHT, DEFAULT_WIDTH, type ChartConfig } from './spec';
export { chartConfigFor, chartDefaults, type ChartChoice, type ChartDefaults, type Unavailable } from './defaults';
export { aggregatePoints, deriveChartData, lttb, xKindOf } from './data';
export type { Aggregate, ChartData, ChartKind, ChartNote, Point, SeriesData, XKind } from './data';
export {
  MAX_SERIES,
  PATTERNS_FROM,
  PATTERN_SIZE,
  SLOTS,
  needsPatterns,
  patternDefs,
  patternId,
  slotColor,
} from './palette';
export type { PatternDef, PatternKind, Slot, SymbolName } from './palette';
export { realizePlot } from './types';
export type { ChartSpec, LegendEntry, MarkSpec, PieSlice, PlotMarks, PlotOptions, SeriesStyle } from './types';
