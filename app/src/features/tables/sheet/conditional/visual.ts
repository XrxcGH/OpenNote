// The rules that draw: color scales, data bars, and icon sets (R-SHT-15). Worked from their documented behavior:
// a scale mixes its stop colors in OKLab, a bar is as wide as the value's share of the range from the axis, and an
// icon is chosen by the thresholds. Colors are resolved for the scheme in use.

import { resolveColor, type Scheme } from '../../../../ui/color/parse';
import { t } from '../../../../strings/t';
import { isObject, own, type JsonObject } from '../model/json';
import { numberOf, valueOfCell, type CellValue } from './value';
import { mixLab } from './oklab';
import { evaluateFormula } from './formula';
import { formulaContext, operandOf, type RuleContext } from './match';
import { percentile, statsOf, type Stats } from './stats';

/** A level of a scale, a bar end, or an icon threshold, as a number. Undefined when it cannot be read. */
export function levelOf(at: unknown, value: unknown, stats: Stats, c: RuleContext): number | undefined {
  const read = (): number | undefined => {
    const v = operandOf(value, c);
    return v.kind === 'num' ? v.n : undefined;
  };
  switch (at) {
    case 'min':
      return stats.min;
    case 'max':
      return stats.max;
    case 'num':
      return read();
    case 'percent': {
      const p = read();
      return p === undefined ? undefined : stats.min + (p / 100) * (stats.max - stats.min);
    }
    case 'percentile': {
      const p = read();
      return p === undefined ? undefined : percentile(stats.numbers, p / 100);
    }
    case 'formula': {
      const v = typeof value === 'string' ? evaluateFormula(value, formulaContext(c)) : undefined;
      return v?.kind === 'num' ? v.n : undefined;
    }
    default:
      return undefined;
  }
}

function colorFor(value: unknown, scheme: Scheme, fallback: string): string {
  return (typeof value === 'string' ? resolveColor(value, scheme) : null) ?? (resolveColor(fallback, scheme) as string);
}

function numberAt(c: RuleContext): number | undefined {
  return numberOf(valueOfCell(c.sheet, c.table, c.row, c.col));
}

/** The fill a color scale gives a number cell, as `#rrggbb`. Undefined for a cell that is not a number. */
export function scaleColor(c: RuleContext, scheme: Scheme): string | undefined {
  const n = numberAt(c);
  const stops = own(c.rule.rule, 'stops');
  if (n === undefined || !Array.isArray(stops) || stops.length < 2) return undefined;
  const stats = statsOf(c.sheet, c.table, c.rule);
  const fallbacks = ['brick', 'amber', 'fern'];
  const list = stops.filter(isObject).map((s, i) => ({
    at: levelOf(s.at, s.value, stats, c),
    color: colorFor(s.color, scheme, fallbacks[i] ?? 'fern'),
  }));
  // A stop that cannot be read takes its neighbor's level, so the scale still draws.
  const levels = list.map((s, i) => s.at ?? (i === 0 ? stats.min : (list[i - 1].at ?? stats.min)));
  for (let i = 1; i < levels.length; i++) levels[i] = Math.max(levels[i], levels[i - 1]);
  const last = list.length - 1;
  if (n <= levels[0]) return list[0].color;
  if (n >= levels[last]) return list[last].color;
  let i = 0;
  while (n > levels[i + 1]) i++;
  const span = levels[i + 1] - levels[i];
  return mixLab(list[i].color, list[i + 1].color, span === 0 ? 1 : (n - levels[i]) / span);
}

export interface Bar {
  /** Where the bar starts and how wide it is, as a percent of the cell's width. */
  left: number;
  width: number;
  /** The side of the axis the bar grows to. */
  side: 'right' | 'left';
  /** Where the axis is, as a percent of the cell's width. */
  axis: number;
  color: string;
  gradient: boolean;
  border?: string;
  barOnly: boolean;
}

/** The data bar of a number cell, or undefined when the cell is not a number. */
export function barOf(c: RuleContext, scheme: Scheme): Bar | undefined {
  const n = numberAt(c);
  if (n === undefined) return undefined;
  const rule = c.rule.rule;
  const stats = statsOf(c.sheet, c.table, c.rule);
  const end = (key: 'min' | 'max'): number => {
    const e = own(rule, key);
    const at = isObject(e) ? e.at : 'auto';
    const found = at === 'auto' ? undefined : levelOf(at, isObject(e) ? e.value : undefined, stats, c);
    // Automatic ends include zero, so a bar of all positive numbers starts at the left edge.
    return found ?? (key === 'min' ? Math.min(0, stats.min) : Math.max(0, stats.max));
  };
  const min = end('min');
  const max = Math.max(end('max'), min);
  const span = max - min;
  const axisMode =
    own(rule, 'axis') === 'middle' || own(rule, 'axis') === 'none' ? (own(rule, 'axis') as string) : 'auto';
  let axis: number;
  let unit: number;
  if (axisMode === 'middle') {
    axis = 50;
    unit = Math.max(Math.abs(min), Math.abs(max)) === 0 ? 0 : 50 / Math.max(Math.abs(min), Math.abs(max));
  } else if (axisMode === 'none' || min >= 0) {
    axis = 0;
    unit = span === 0 ? 0 : 100 / span;
  } else if (max <= 0) {
    axis = 100;
    unit = 100 / -min;
  } else {
    axis = (-min / span) * 100;
    unit = 100 / span;
  }
  const value = Math.min(max, Math.max(min, n));
  const negative = value < 0 && axisMode !== 'none';
  // With no negative side the bar grows from the minimum: a minimum of 50 and a maximum of 100 draw 75 at half width.
  const fromMin = axisMode === 'none' || (axisMode === 'auto' && min >= 0);
  let width = fromMin
    ? span === 0
      ? axisMode === 'none'
        ? 100
        : 0
      : ((value - min) / span) * 100
    : Math.abs(value) * unit;
  if (fromMin) width = Math.min(100, width);
  else width = Math.min(width, negative ? axis : 100 - axis);
  width = Math.max(0, width);
  const color = colorFor(n < 0 ? own(rule, 'negative') : own(rule, 'color'), scheme, n < 0 ? 'brick' : 'indigo');
  const border = own(rule, 'border');
  return {
    left: negative ? axis - width : axis,
    width,
    side: negative ? 'left' : 'right',
    axis,
    color,
    gradient: own(rule, 'gradient') !== false,
    border: typeof border === 'string' ? (resolveColor(border, scheme) ?? undefined) : undefined,
    barOnly: own(rule, 'barOnly') === true,
  };
}

interface IconDef {
  glyph: string;
  /** A theme color name for the glyph, or none for the text color. */
  tone?: 'brick' | 'amber' | 'fern';
  text: () => string;
}

const level = (key: 'rating' | 'quarter' | 'box' | 'star', glyphs: string[]): IconDef[] =>
  glyphs.map((glyph, i) => ({
    glyph,
    text: () => t(`sheetConditional.icon.${key}`, { level: i + 1, count: glyphs.length }),
  }));
type IconKey = Extract<Parameters<typeof t>[0], `sheetConditional.icon.${string}`>;
const icon = (glyph: string, key: IconKey, tone?: IconDef['tone']): IconDef => ({
  glyph,
  tone,
  text: () => t(key),
});

/** The icon sets, each from the lowest icon to the highest. */
export const ICON_SETS: Record<string, IconDef[]> = {
  '3Arrows': [
    icon('▼', 'sheetConditional.icon.arrowDown', 'brick'),
    icon('▶', 'sheetConditional.icon.arrowSide', 'amber'),
    icon('▲', 'sheetConditional.icon.arrowUp', 'fern'),
  ],
  '3Triangles': [
    icon('▼', 'sheetConditional.icon.triangleDown', 'brick'),
    icon('▬', 'sheetConditional.icon.triangleFlat', 'amber'),
    icon('▲', 'sheetConditional.icon.triangleUp', 'fern'),
  ],
  '3TrafficLights': [
    icon('○', 'sheetConditional.icon.lightRed', 'brick'),
    icon('◐', 'sheetConditional.icon.lightYellow', 'amber'),
    icon('●', 'sheetConditional.icon.lightGreen', 'fern'),
  ],
  '3Signs': [
    icon('◆', 'sheetConditional.icon.signRed', 'brick'),
    icon('▲', 'sheetConditional.icon.signYellow', 'amber'),
    icon('●', 'sheetConditional.icon.signGreen', 'fern'),
  ],
  '3Symbols': [
    icon('✖', 'sheetConditional.icon.symbolCross', 'brick'),
    icon('!', 'sheetConditional.icon.symbolWarning', 'amber'),
    icon('✔', 'sheetConditional.icon.symbolCheck', 'fern'),
  ],
  '3Flags': [
    icon('⚑', 'sheetConditional.icon.flagRed', 'brick'),
    icon('⚑⚑', 'sheetConditional.icon.flagYellow', 'amber'),
    icon('⚑⚑⚑', 'sheetConditional.icon.flagGreen', 'fern'),
  ],
  '3Stars': level('star', ['☆', '✩', '★']),
  '4Arrows': [
    icon('▼', 'sheetConditional.icon.arrowDown', 'brick'),
    icon('↘', 'sheetConditional.icon.arrowDownRight', 'amber'),
    icon('↗', 'sheetConditional.icon.arrowUpRight', 'amber'),
    icon('▲', 'sheetConditional.icon.arrowUp', 'fern'),
  ],
  '4Rating': level('rating', ['▁', '▃', '▅', '▇']),
  '5Arrows': [
    icon('▼', 'sheetConditional.icon.arrowDown', 'brick'),
    icon('↘', 'sheetConditional.icon.arrowDownRight', 'amber'),
    icon('▶', 'sheetConditional.icon.arrowSide', 'amber'),
    icon('↗', 'sheetConditional.icon.arrowUpRight', 'fern'),
    icon('▲', 'sheetConditional.icon.arrowUp', 'fern'),
  ],
  '5Rating': level('rating', ['▁', '▂', '▄', '▆', '█']),
  '5Quarters': level('quarter', ['○', '◔', '◑', '◕', '●']),
  '5Boxes': level('box', ['□', '▤', '▥', '▦', '■']),
};

export interface Icon {
  glyph: string;
  /** What a screen reader says for the icon. */
  text: string;
  /** The theme color of the glyph, resolved for the scheme, or undefined for the text color. */
  color?: string;
  /** The position of the icon in its set, 0 for the lowest. */
  index: number;
  iconOnly: boolean;
}

/** The icon of a number cell by the rule's thresholds, or undefined when the cell is not a number. */
export function iconOf(c: RuleContext, scheme: Scheme): Icon | undefined {
  const n = numberAt(c);
  const rule = c.rule.rule;
  const name = String(own(rule, 'set') ?? '3Arrows');
  // An unknown set, or a name such as `constructor` from a hostile note, makes the rule do nothing.
  const set = Object.hasOwn(ICON_SETS, name) ? ICON_SETS[name] : undefined;
  if (n === undefined || !set) return undefined;
  const stats = statsOf(c.sheet, c.table, c.rule);
  const cuts = (Array.isArray(own(rule, 'thresholds')) ? (own(rule, 'thresholds') as unknown[]) : []).filter(isObject);
  // Without thresholds the range splits in equal percents; each threshold is the bottom of the icon above it.
  const edges = set.slice(1).map((_, i) => {
    const cut: JsonObject = cuts[i] ?? { at: 'percent', value: String(((i + 1) * 100) / set.length) };
    return { at: levelOf(cut.at, cut.value, stats, c), gte: cut.gte !== false };
  });
  let index = 0;
  edges.forEach((e, i) => {
    if (e.at !== undefined && (e.gte ? n >= e.at : n > e.at)) index = i + 1;
  });
  if (own(rule, 'reverse') === true) index = set.length - 1 - index;
  const def = set[index];
  return {
    glyph: def.glyph,
    text: def.text(),
    color: def.tone ? (resolveColor(def.tone, scheme) ?? undefined) : undefined,
    index,
    iconOnly: own(rule, 'iconOnly') === true,
  };
}

export type { CellValue };
