// Frequency tables: numbers sorted into classes of equal width, a class table typed directly (grouped data), and
// counts of categories. Grouped data gets its mean, standard deviation, interpolated median, and modal class.
import { toNumber } from '../num/data';
import { check, num, step, tex, type Cell, type KitStep, type KitTable, type Report } from '../report';

export interface ClassCount {
  readonly lo: number;
  readonly hi: number;
  readonly count: number;
}

/** A round class width that gives about Sturges' number of classes. */
export function autoWidth(values: readonly number[]): number {
  const range = Math.max(...values) - Math.min(...values);
  if (range === 0) return 1;
  const k = Math.ceil(Math.log2(values.length)) + 1;
  const raw = range / k;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].find((m) => m * power >= raw)! * power;
}

/** Classes [lo, lo + width), from `start` (a multiple of the width below the least value unless given). */
export function classify(values: readonly number[], width: number, start?: number): ClassCount[] {
  check(values.length > 0, 'empty');
  check(width > 0, 'widthPositive');
  const min = Math.min(...values);
  const max = Math.max(...values);
  const first = start ?? Math.floor(min / width + 1e-9) * width;
  check(first <= min, 'startAbove');
  const count = Math.floor((max - first) / width + 1e-9) + 1;
  check(count <= 500, 'tooManyClasses');
  const classes = Array.from({ length: count }, (_, i) => ({
    lo: Number((first + i * width).toPrecision(12)),
    hi: Number((first + (i + 1) * width).toPrecision(12)),
    count: 0,
  }));
  for (const x of values) classes[Math.min(count - 1, Math.floor((x - first) / width + 1e-9))].count += 1;
  return classes;
}

const CLASS_LINE = /^\s*(-?\d*\.?\d+)\s*(?:-|–|to)\s*(-?\d*\.?\d+)\s*[:,=\s]\s*(\d*\.?\d+)\s*$/i;

/** A class table typed one class to a line, as "0-10: 5" or "0 to 10, 5". */
export function parseClasses(text: string): ClassCount[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  check(lines.length > 0, 'empty');
  const classes = lines.map((line) => {
    const match = CLASS_LINE.exec(line.replace(/−/g, '-'));
    check(match !== null, 'classLine', { text: line.trim().slice(0, 32) });
    const [lo, hi, count] = [toNumber(match[1]), toNumber(match[2]), toNumber(match[3])];
    check(hi > lo, 'classOrder', { text: line.trim().slice(0, 32) });
    return { lo, hi, count };
  });
  classes.forEach((c, i) => check(i === 0 || c.lo >= classes[i - 1].lo, 'classOrder', { text: `${c.lo}` }));
  return classes;
}

export interface Grouped {
  readonly n: number;
  readonly mean: number;
  readonly sd: number;
  readonly median: number;
  readonly modalClass: ClassCount;
  readonly mode: number;
}

/** Grouped mean and SD from class midpoints; median = L + ((n/2 − CF)/f)·h; mode interpolated in the modal class. */
export function groupedStats(classes: readonly ClassCount[]): { stats: Grouped; steps: KitStep[] } {
  const n = classes.reduce((t, c) => t + c.count, 0);
  check(n > 0, 'noCounts');
  const mids = classes.map((c) => (c.lo + c.hi) / 2);
  const fm = classes.reduce((t, c, i) => t + c.count * mids[i], 0);
  const mean = fm / n;
  const ss = classes.reduce((t, c, i) => t + c.count * (mids[i] - mean) ** 2, 0);
  let cf = 0;
  let at = 0;
  while (cf + classes[at].count < n / 2) cf += classes[at++].count;
  const c = classes[at];
  const h = c.hi - c.lo;
  const median = c.lo + ((n / 2 - cf) / c.count) * h;
  const top = classes.reduce((best, one, i) => (one.count > classes[best].count ? i : best), 0);
  const modal = classes[top];
  const f0 = classes[top - 1]?.count ?? 0;
  const f2 = classes[top + 1]?.count ?? 0;
  const spread = 2 * modal.count - f0 - f2;
  const mode =
    spread > 0 ? modal.lo + ((modal.count - f0) / spread) * (modal.hi - modal.lo) : (modal.lo + modal.hi) / 2;
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : NaN;
  const steps = [
    step('gMean', `\\bar{x} \\approx \\frac{\\sum f m}{n} = \\frac{${tex(fm)}}{${n}} = ${tex(mean)}`),
    step(
      'gMedian',
      `\\tilde{x} = L + \\frac{n/2 - CF}{f}\\,h = ${tex(c.lo)} + \\frac{${tex(n / 2)} - ${tex(cf)}}{${tex(c.count)}}` +
        `\\cdot ${tex(h)} = ${tex(median)}`,
      { lo: num(c.lo), hi: num(c.hi) },
    ),
    step(
      'gMode',
      `\\text{mode} = L + \\frac{f_1 - f_0}{2f_1 - f_0 - f_2}\\,h = ${tex(modal.lo)} + \\frac{${tex(modal.count)} - ${tex(f0)}}` +
        `{${tex(spread)}}\\cdot ${tex(modal.hi - modal.lo)} = ${tex(mode)}`,
    ),
    step('gSd', `s \\approx \\sqrt{\\frac{\\sum f (m - \\bar{x})^2}{n - 1}} = ${tex(sd)}`),
  ];
  return { stats: { n, mean, sd, median, modalClass: modal, mode }, steps };
}

export function classTable(classes: readonly ClassCount[]): KitTable {
  const n = classes.reduce((t, c) => t + c.count, 0);
  let running = 0;
  const rows = classes.map((c): Cell[] => {
    running += c.count;
    return [`${num(c.lo)} – ${num(c.hi)}`, (c.lo + c.hi) / 2, c.count, c.count / n, running, running / n];
  });
  return {
    title: 'frequency',
    columns: ['class', 'midpoint', 'count', 'relative', 'cumulative', 'cumulativeRelative'],
    rows,
  };
}

/** The Classes and Grouped modes: the class table, the grouped statistics, and a histogram. */
export function groupedReport(classes: readonly ClassCount[], unit: string): Report {
  const { stats, steps } = groupedStats(classes);
  const u = unit ? ` ${unit}` : '';
  const rows: Cell[][] = [
    [{ key: 'n' }, stats.n, ''],
    [{ key: 'mean' }, stats.mean, unit],
    [{ key: 'median' }, stats.median, unit],
    [{ key: 'mode' }, stats.mode, unit],
    [{ key: 'modalClass' }, `${num(stats.modalClass.lo)} – ${num(stats.modalClass.hi)}`, unit],
    [{ key: 'sd' }, stats.sd, unit],
  ];
  return {
    answer: {
      key: 'grouped',
      vars: { mean: num(stats.mean), median: num(stats.median), n: `${stats.n}`, unit: u },
      latex: `\\bar{x} \\approx ${tex(stats.mean)},\\; \\tilde{x} = ${tex(stats.median)},\\; n = ${stats.n}`,
    },
    tables: [classTable(classes), { title: 'groupedSummary', columns: ['statistic', 'value', 'unit'], rows }],
    steps,
    plots: [
      {
        title: 'histogram',
        x: { label: 'value' },
        y: { label: 'count', min: 0 },
        marks: [{ kind: 'bars', bars: classes.map((c) => ({ x0: c.lo, x1: c.hi, y: c.count })) }],
      },
    ],
  };
}

/** Category labels from a paste: one to a line, or split by commas on a single line. */
export function parseCategories(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const labels =
    lines.length === 1
      ? lines[0]
          .split(/[,;\t]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : lines;
  check(labels.length > 0, 'empty');
  return labels;
}

/** The Categories mode: counts in order of first appearance, shares, the mode, and a bar chart. */
export function categoryReport(labels: readonly string[]): Report {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  const n = labels.length;
  let running = 0;
  const entries = [...counts];
  const rows = entries.map(([label, count]): Cell[] => {
    running += count;
    return [label, count, count / n, running, running / n];
  });
  const most = Math.max(...counts.values());
  const modes = entries.filter(([, c]) => c === most).map(([label]) => label);
  return {
    answer: {
      key: 'categories',
      vars: { mode: modes.join(', '), count: `${most}`, n: `${n}`, kinds: `${entries.length}` },
      latex: `\\text{mode} = \\text{${modes.join(', ').replace(/[\\{}$&#^_%~]/g, '')}},\\; n = ${n}`,
    },
    tables: [
      { title: 'frequency', columns: ['category', 'count', 'relative', 'cumulative', 'cumulativeRelative'], rows },
    ],
    steps: [],
    plots: [
      {
        title: 'barChart',
        x: { label: 'category', categories: entries.map(([label]) => label) },
        y: { label: 'count', min: 0 },
        marks: [{ kind: 'bars', bars: entries.map(([, c], i) => ({ x0: i - 0.35, x1: i + 0.35, y: c })) }],
      },
    ],
  };
}
