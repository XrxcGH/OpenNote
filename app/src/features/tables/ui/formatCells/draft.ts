// The dialog's working copy of a style and what OK writes. The dialog edits a copy of the first selected cell's style
// as the table draws it. On OK only the properties that changed are written, so a property the person did not touch
// stays as it is on every selected cell (Excel does the same for a selection with mixed formats).
import { canonical } from '../../sheet/model';
import type { CellStyle, Fill, StyleChange } from '../../sheet/model';
import type { Json } from '../../sheet/model/json';

type Group = 'font' | 'align' | 'pad' | 'protect';

const same = (a: unknown, b: unknown): boolean => canonical(a as Json) === canonical(b as Json);

/** The value of one property of a group, or undefined. */
export const prop = <K extends Group>(style: CellStyle, group: K, key: string): unknown =>
  (style[group] as Record<string, unknown> | undefined)?.[key];

/** A copy of the style with one property of a group set, or removed when `value` is undefined. */
/** A typed number held to the format's limits: clamped to the range and rounded to the nearest step (0.5 or 1). */
export function snapNumber(n: number, min: number, max: number, step: number): number {
  const snapped = Math.round(n / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

/** The style with its font face set. A numeric weight goes too, so Regular and Italic are not still heavy. */
export function withFace(style: CellStyle, bold: boolean, italic: boolean): CellStyle {
  const faced = withProp(withProp(style, 'font', 'bold', bold || undefined), 'font', 'italic', italic || undefined);
  return withProp(faced, 'font', 'weight', undefined);
}

export function withProp(style: CellStyle, group: Group, key: string, value: unknown): CellStyle {
  const next: Record<string, unknown> = { ...((style[group] as Record<string, unknown> | undefined) ?? {}) };
  if (value === undefined) delete next[key];
  else next[key] = value;
  const out: CellStyle = { ...style };
  if (Object.keys(next).length === 0) delete out[group];
  else (out as Record<string, unknown>)[group] = next;
  return out;
}

/** A copy of the style with the number format set (null removes it, so the table's own format shows). */
export function withFormat(style: CellStyle, code: string | null): CellStyle {
  const out = { ...style };
  if (code === null) delete out.fmt;
  else out.fmt = code;
  return out;
}

/** A copy of the style with the fill set (null removes it). */
export function withFill(style: CellStyle, fill: Fill | null): CellStyle {
  const out = { ...style };
  if (fill === null) delete out.fill;
  else out.fill = fill;
  return out;
}

/**
 * What to write to turn `before` into `after`: a value for each changed property, `null` for each removed one. Returns
 * null when nothing changed. A removed property is written as `null`, which takes it from the cell's own style (a look or a
 * column may still give it).
 */
export function styleDiff(before: CellStyle, after: CellStyle): StyleChange | null {
  const change: Record<string, unknown> = {};
  for (const key of ['fmt', 'fill'] as const) {
    if (same(before[key], after[key])) continue;
    change[key] = after[key] === undefined ? null : after[key];
  }
  for (const key of ['font', 'align', 'pad', 'protect', 'border'] as const) {
    const a = (before[key] ?? {}) as Record<string, unknown>;
    const b = (after[key] ?? {}) as Record<string, unknown>;
    const inner: Record<string, unknown> = {};
    for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (same(a[name], b[name])) continue;
      inner[name] = b[name] === undefined ? null : b[name];
    }
    if (Object.keys(inner).length > 0) change[key] = inner;
  }
  return Object.keys(change).length === 0 ? null : (change as StyleChange);
}

export const FILL_KINDS = ['none', 'solid', 'pattern', 'gradient'] as const;
export type FillKind = (typeof FILL_KINDS)[number];

export function fillKind(fill: Fill | undefined): FillKind {
  if (fill === undefined || fill === 'none') return 'none';
  if (typeof fill === 'string') return 'solid';
  return 'gradient' in fill ? 'gradient' : 'pattern';
}

/** Two or three stops from the first color to the last, evenly spaced. */
export function gradientOf(colors: readonly string[], angle: number): Fill {
  const stops = colors.map((color, i) => ({ at: colors.length === 1 ? 0 : i / (colors.length - 1), color }));
  return { gradient: { angle, stops } };
}
