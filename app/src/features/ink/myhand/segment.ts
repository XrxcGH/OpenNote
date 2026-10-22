// Upload pages to symbols the person can confirm. Strokes go into lines of writing, and lines into symbols. Once the
// person has said what each symbol is, the letters on each line give its baseline and x-height, so a symbol
// from a scan is sized like the letters from the pen. The habits of their math layout (script size and height,
// fraction bars, big operators) are measured from the same confirmed symbols.
import { ASCENDER_LETTERS, CAP_LETTERS, DIGITS, X_HEIGHT_LETTERS } from './charset';
import { median } from './metrics';
import { DEFAULT_HABITS } from './style';
import type { HandMetrics, MathHabits } from './style';
import type { Traced } from './trace';

export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function rectOf(strokes: readonly Traced[]): Rect {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const stroke of strokes) {
    for (const p of stroke) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
  }
  return { x0, y0, x1, y1 };
}

const heightOf = (r: Rect) => r.y1 - r.y0;
const widthOf = (r: Rect) => r.x1 - r.x0;

/** A line of writing: its strokes in reading order. */
export interface WrittenLine {
  readonly strokes: Traced[];
  readonly rect: Rect;
}

interface Item {
  readonly stroke: Traced;
  readonly rect: Rect;
}

/** The middle part of a stroke's height, which the strokes beside it on its line share. */
const core = (r: Rect, typical: number) => {
  const h = heightOf(r);
  const trim = h > typical ? (h - typical) / 2 : 0;
  return { top: r.y0 + trim + h * 0.15, bottom: r.y1 - trim - h * 0.15 };
};

/** Joins strokes that sit side by side on one line: their middles overlap and nothing wide separates them. */
function joinNeighbours(items: readonly Item[], typical: number): number[] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const order = items.map((_, i) => i).sort((a, b) => items[a].rect.x0 - items[b].rect.x0);
  for (let a = 0; a < order.length; a++) {
    const i = order[a];
    const ci = core(items[i].rect, typical);
    for (let b = a + 1; b < order.length; b++) {
      const j = order[b];
      // Sorted by left edge: once one starts too far right, the rest do too.
      if (items[j].rect.x0 - items[i].rect.x1 > typical * 8) break;
      const cj = core(items[j].rect, typical);
      if (Math.min(ci.bottom, cj.bottom) - Math.max(ci.top, cj.top) > 0) parent[find(i)] = find(j);
    }
  }
  return items.map((_, i) => find(i));
}

/**
 * Strokes into lines. Strokes whose middles overlap and that stand near each other join, and those chains are the
 * lines; small marks (dots, bars, accents) then join the line nearest them.
 */
export function splitLines(strokes: readonly Traced[]): WrittenLine[] {
  const items: Item[] = strokes.filter((s) => s.length > 0).map((stroke) => ({ stroke, rect: rectOf([stroke]) }));
  if (items.length === 0) return [];
  const typical = median(items.map((i) => heightOf(i.rect)).filter((h) => h > 0)) || 1;
  const isSmall = (i: Item) => heightOf(i.rect) < typical * 0.35 && widthOf(i.rect) < typical * 0.8;
  const big = items.filter((i) => !isSmall(i));
  const roots = joinNeighbours(big, typical);
  const groups = new Map<number, Item[]>();
  big.forEach((item, k) => groups.set(roots[k], [...(groups.get(roots[k]) ?? []), item]));
  const lines = [...groups.values()].map((list) => ({ items: list, rect: rectOf(list.map((i) => i.stroke)) }));
  for (const item of items.filter(isSmall)) {
    const mx = (item.rect.x0 + item.rect.x1) / 2;
    const my = (item.rect.y0 + item.rect.y1) / 2;
    let best: (typeof lines)[number] | null = null;
    let bestD = typical * 2.5;
    for (const line of lines) {
      const dx = Math.max(0, line.rect.x0 - mx, mx - line.rect.x1);
      const dy = Math.max(0, line.rect.y0 - my, my - line.rect.y1);
      const d = Math.hypot(dx * 2, dy);
      if (d < bestD) [best, bestD] = [line, d];
    }
    if (best) best.items.push(item);
    else lines.push({ items: [item], rect: item.rect });
  }
  return lines
    .map((line) => {
      const ordered = [...line.items].sort((a, b) => a.rect.x0 - b.rect.x0).map((i) => i.stroke);
      return { strokes: ordered, rect: rectOf(ordered) };
    })
    .sort((a, b) => a.rect.y0 + a.rect.y1 - (b.rect.y0 + b.rect.y1) || a.rect.x0 - b.rect.x0);
}

/** A symbol: strokes that belong together, as one character or mark. */
export interface SymbolGroup {
  readonly strokes: Traced[];
  readonly rect: Rect;
}

/**
 * A plain grouping for when the math grouping can't load: strokes that overlap across, or nearly touch, are one
 * symbol. An equals sign's two bars, and the dot of an i, overlap their partner across, so they stay together.
 */
export function groupSymbols(line: WrittenLine): SymbolGroup[] {
  const typical = median(line.strokes.map((s) => heightOf(rectOf([s])))) || 1;
  const groups: { strokes: Traced[]; rect: Rect }[] = [];
  for (const stroke of line.strokes) {
    const rect = rectOf([stroke]);
    const last = groups[groups.length - 1];
    const overlap = last ? Math.min(last.rect.x1, rect.x1) - Math.max(last.rect.x0, rect.x0) : -Infinity;
    if (
      last &&
      overlap > -typical * 0.05 &&
      overlap > Math.min(widthOf(rect), widthOf(last.rect)) * 0.3 - typical * 0.05
    ) {
      last.strokes.push(stroke);
      last.rect = rectOf(last.strokes);
    } else groups.push({ strokes: [stroke], rect });
  }
  return groups;
}

/** A symbol and what the person said it is. */
export interface Labelled {
  readonly label: string;
  readonly rect: Rect;
  /** Which line it is on. */
  readonly line: number;
}

/** A line's baseline and x-height. */
export interface LineMeasure {
  readonly baseline: number;
  readonly xHeight: number;
}

/**
 * Each line's baseline and x-height from the symbols on it the person named: small letters give the x-height
 * directly, capitals, digits, and tall letters through the person's own proportions. A line with none of those
 * takes the nearest line's x-height and its own lowest common edge.
 */
export function measureLines(symbols: readonly Labelled[], lineCount: number, metrics: HandMetrics): LineMeasure[] {
  const out: (LineMeasure | null)[] = [];
  for (let line = 0; line < lineCount; line++) {
    const on = symbols.filter((s) => s.line === line);
    const sizes: number[] = [];
    const bottoms: number[] = [];
    for (const s of on) {
      const h = heightOf(s.rect);
      if (X_HEIGHT_LETTERS.includes(s.label)) sizes.push(h);
      else if (CAP_LETTERS.includes(s.label) || DIGITS.includes(s.label)) sizes.push(h / metrics.capHeight);
      else if (ASCENDER_LETTERS.includes(s.label) && s.label !== 't') sizes.push(h / metrics.ascender);
      else continue;
      bottoms.push(s.rect.y1);
    }
    out.push(sizes.length > 0 ? { baseline: median(bottoms), xHeight: median(sizes) } : null);
  }
  const known = out.filter((m): m is LineMeasure => m !== null);
  const fallbackXh = known.length > 0 ? median(known.map((m) => m.xHeight)) : 0;
  return out.map((m, line) => {
    if (m) return m;
    const on = symbols.filter((s) => s.line === line);
    const bottom = on.length > 0 ? median(on.map((s) => s.rect.y1)) : 0;
    const xHeight = fallbackXh || (on.length > 0 ? median(on.map((s) => heightOf(s.rect))) * 0.7 : 1);
    return { baseline: bottom, xHeight };
  });
}

const SCRIPT_BASE = /^[\p{L}\p{N})\]]$/u;

/** How big the letters and digits written just under and over a sum or a product are, against full size. */
function limitSizes(
  op: Labelled,
  symbols: readonly Labelled[],
  xh: number,
  expected: (label: string, xh: number) => number | null,
): number[] {
  const out: number[] = [];
  for (const o of symbols) {
    const mid = (o.rect.x0 + o.rect.x1) / 2;
    if (o === op || mid < op.rect.x0 - xh * 0.3 || mid > op.rect.x1 + xh * 0.3) continue;
    const near =
      (o.rect.y0 > op.rect.y1 && o.rect.y0 - op.rect.y1 < xh) ||
      (o.rect.y1 < op.rect.y0 && op.rect.y0 - o.rect.y1 < xh);
    const full = expected(o.label, xh);
    if (near && full) out.push(heightOf(o.rect) / full);
  }
  return out;
}

/** The person's math layout habits from confirmed symbols, blended with what the style already holds. */
export function measureHabits(
  symbols: readonly Labelled[],
  lines: readonly LineMeasure[],
  current: MathHabits = DEFAULT_HABITS,
): MathHabits {
  const scale: number[] = [];
  const raise: number[] = [];
  const drop: number[] = [];
  const overhang: number[] = [];
  const gaps: number[] = [];
  const bigOps: number[] = [];
  const limits: number[] = [];
  const expected = (label: string, xh: number) =>
    X_HEIGHT_LETTERS.includes(label) ? xh : CAP_LETTERS.includes(label) || DIGITS.includes(label) ? xh * 1.45 : null;
  for (const s of symbols) {
    const line = lines[s.line];
    if (!line || !(line.xHeight > 0)) continue;
    const xh = line.xHeight;
    if ('∫∑∏'.includes(s.label)) bigOps.push(heightOf(s.rect) / (xh * 1.45));
    if ('∑∏'.includes(s.label)) limits.push(...limitSizes(s, symbols, xh, expected));
    const full = expected(s.label, xh);
    if (full) {
      // A script: a letter or digit smaller than its line's, raised, or lowered, just after another symbol.
      const before = symbols.filter(
        (o) => o.line === s.line && o !== s && o.rect.x1 <= s.rect.x0 + xh * 0.1 && s.rect.x0 - o.rect.x1 < xh * 0.6,
      );
      const base = before.sort((a, b) => b.rect.x1 - a.rect.x1)[0];
      const ratio = heightOf(s.rect) / full;
      if (base && SCRIPT_BASE.test(base.label) && ratio < 0.85 && ratio > 0.3) {
        if (s.rect.y1 < line.baseline - xh * 0.3) {
          scale.push(ratio);
          raise.push((line.baseline - s.rect.y1) / xh);
        } else if (s.rect.y1 > line.baseline + xh * 0.2) {
          scale.push(ratio);
          drop.push((s.rect.y1 - line.baseline) / xh);
        }
      }
    }
    // A fraction bar: a long level stroke with symbols over and under it.
    if ('-—–_'.includes(s.label) && widthOf(s.rect) > xh * 1.2 && heightOf(s.rect) < xh * 0.4) {
      const barY = (s.rect.y0 + s.rect.y1) / 2;
      const within = symbols.filter(
        (o) => o !== s && o.rect.x0 >= s.rect.x0 - xh * 0.5 && o.rect.x1 <= s.rect.x1 + xh * 0.5,
      );
      const above = within.filter((o) => o.rect.y1 <= barY && barY - o.rect.y1 < xh * 1.5);
      const below = within.filter((o) => o.rect.y0 >= barY && o.rect.y0 - barY < xh * 1.5);
      if (above.length > 0 && below.length > 0) {
        const span = (list: Labelled[]) =>
          Math.max(...list.map((o) => o.rect.x1)) - Math.min(...list.map((o) => o.rect.x0));
        overhang.push((widthOf(s.rect) - Math.max(span(above), span(below))) / 2 / xh);
        gaps.push(
          (barY - Math.max(...above.map((o) => o.rect.y1))) / xh,
          (Math.min(...below.map((o) => o.rect.y0)) - barY) / xh,
        );
      }
    }
  }
  const blend = (values: number[], old: number, lo: number, hi: number) =>
    values.length === 0
      ? old
      : Math.min(hi, Math.max(lo, (old + median(values) * values.length) / (values.length + 1)));
  return {
    ...current,
    scriptScale: blend(scale, current.scriptScale, 0.35, 0.95),
    supRaise: blend(raise, current.supRaise, 0.3, 2.5),
    subDrop: blend(drop, current.subDrop, 0.05, 1.5),
    fracOverhang: blend(overhang, current.fracOverhang, 0, 1.5),
    fracGap: blend(gaps, current.fracGap, 0.05, 1.5),
    bigOpScale: blend(bigOps, current.bigOpScale, 0.9, 3.5),
    limitScale: blend(limits, current.limitScale, 0.3, 1),
  };
}
