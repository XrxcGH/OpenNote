// Stem-and-leaf displays (with split stems, and back to back for 2 samples) and dot plots. Leaves are the digit
// after the stem, cut (not rounded) at the leaf unit, as textbooks draw them.
import type { PlotSpec } from '../plot';
import { check, num, type Report } from '../report';

export interface Stems {
  readonly lines: readonly string[];
  /** The value one leaf digit stands for, such as 1 or 0.1. */
  readonly leafUnit: number;
  /** A line that reads the display: stem 1 with leaf 2 stands for this value. */
  readonly example: { stem: string; leaf: string; value: string };
}

interface Leafed {
  stem: number;
  negative: boolean;
  leaf: number;
}

/** A leaf unit that gives between 1 and 10 stems over the range of the data. */
export function autoLeafUnit(values: readonly number[]): number {
  const range = Math.max(...values) - Math.min(...values);
  const big = Math.max(...values.map(Math.abs));
  const span = range > 0 ? range : big > 0 ? big : 1;
  return 10 ** (Math.floor(Math.log10(span)) - 1);
}

function split(x: number, unit: number): Leafed {
  const scaled = Math.floor(Math.abs(x) / unit + 1e-9);
  return { stem: Math.floor(scaled / 10), negative: x < 0, leaf: scaled % 10 };
}

interface StemRow {
  readonly negative: boolean;
  readonly stem: number;
}

/**
 * The display as lines such as "1 | 2 5". A second sample makes it back to back: its leaves run leftward from the
 * stem, as in "5 2 | 1 | 2 5". Each line has an order key: stems (or half stems) count up from 0 for values of 0
 * and more, and down from -1 for negative values, so -0 sits just below 0.
 */
export function stemAndLeaf(
  values: readonly number[],
  options: { leafUnit?: number | null; split?: boolean; other?: readonly number[] } = {},
): Stems {
  check(values.length > 0, 'empty');
  const unit = options.leafUnit ?? autoLeafUnit([...values, ...(options.other ?? [])]);
  check(unit > 0, 'leafUnit');
  const per = options.split ? 2 : 1;
  const keyOf = (l: Leafed) => {
    const k = l.stem * per + (per === 2 && l.leaf >= 5 ? 1 : 0);
    return l.negative ? -k - 1 : k;
  };
  const rowOf = (key: number): StemRow => {
    const negative = key < 0;
    return { negative, stem: Math.floor((negative ? -key - 1 : key) / per) };
  };
  const right = values.map((x) => split(x, unit));
  const left = (options.other ?? []).map((x) => split(x, unit));
  const keys = [...right, ...left].map(keyOf);
  const lo = Math.min(...keys);
  const hi = Math.max(...keys);
  check(hi - lo < 200, 'tooManyStems');
  const leaves = (set: readonly Leafed[], key: number) =>
    set
      .filter((l) => keyOf(l) === key)
      .map((l) => l.leaf)
      .sort((a, b) => (key < 0 ? b - a : a - b));
  const rows = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const width = Math.max(...rows.map((key) => stemLabel(rowOf(key)).length));
  const leftTexts = rows.map((key) => leaves(left, key).reverse().join(' '));
  const leftWidth = Math.max(0, ...leftTexts.map((text) => text.length));
  const lines = rows.map((key, i) => {
    const stem = stemLabel(rowOf(key)).padStart(width);
    const rightText = leaves(right, key).join(' ');
    return (
      left.length ? `${leftTexts[i].padStart(leftWidth)} | ${stem} | ${rightText}` : `${stem} | ${rightText}`
    ).trimEnd();
  });
  const first = right[0];
  return {
    lines,
    leafUnit: unit,
    example: {
      stem: stemLabel(first),
      leaf: `${first.leaf}`,
      value: num((first.negative ? -1 : 1) * (first.stem * 10 + first.leaf) * unit),
    },
  };
}

const stemLabel = (r: StemRow) => `${r.negative ? '-' : ''}${r.stem}`;

/** Dots stacked over each value, rounded to 3 significant figures so near values share a column. */
export function dotPlot(values: readonly number[]): PlotSpec {
  const seen = new Map<number, number>();
  const points = values.map((x) => {
    const at = Number(x.toPrecision(3));
    const height = (seen.get(at) ?? 0) + 1;
    seen.set(at, height);
    return { x: at, y: height };
  });
  return {
    title: 'dotPlot',
    x: { label: 'value' },
    y: { label: 'count', min: 0, max: Math.max(...points.map((p) => p.y)) + 1 },
    marks: [{ kind: 'points', points }],
  };
}

/** The Stem-and-leaf mode: the display, the key that reads it, and a dot plot. */
export function stemReport(values: readonly number[], options: Parameters<typeof stemAndLeaf>[1]): Report {
  const stems = stemAndLeaf(values, options);
  return {
    answer: {
      key: 'stems',
      vars: { ...stems.example, unit: num(stems.leafUnit) },
      latex: `\\text{${stems.example.stem} | ${stems.example.leaf}} = ${stems.example.value}`,
    },
    tables: [],
    steps: [],
    blocks: [{ title: options?.other?.length ? 'backToBack' : 'stemAndLeaf', text: stems.lines.join('\n') }],
    plots: [dotPlot(values)],
    notes: [{ key: 'stemKey', vars: { ...stems.example, unit: num(stems.leafUnit) } }],
  };
}
