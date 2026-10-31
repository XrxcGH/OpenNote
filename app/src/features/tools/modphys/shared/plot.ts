// Plots as a small SVG tree. A plot has axes with round ticks and four kinds of series: line, dashed, stick, and dot.
// Labeled level lines draw energy diagrams. The tree is pure data, so the window draws it with theme colors and
// Insert writes it as an SVG file with the light palette. Series differ by dash pattern and label as well as color.
import { tokens } from '../../../../theme/tokens';

export type SeriesKind = 'line' | 'dash' | 'sticks' | 'dots';

export interface Series {
  points: readonly (readonly [number, number])[];
  kind?: SeriesKind;
  label?: string;
  /** Which of the four series colors: 0 to 3. */
  tone?: number;
  /** For dots: a name written beside each point (empty for none) and each dot's radius in pixels. */
  names?: readonly string[];
  sizes?: readonly number[];
  /** For dots: a short muted tag under each point, dropped where it would cover another label. */
  tags?: readonly string[];
  /** The names may be dropped where they would cover another series' label (the bright stars under the planets). */
  minorNames?: boolean;
}

export interface Level {
  y: number;
  label: string;
  /** The level line's horizontal extent; the whole plot when absent. */
  from?: number;
  to?: number;
  tone?: number;
}

export interface PlotSpec<L extends string = string> {
  /** Says what the plot shows, for the picture's description. Engines put string keys here. */
  title: L;
  xLabel: L;
  yLabel: L;
  series: readonly Series[];
  levels?: readonly Level[];
  x?: readonly [number, number];
  y?: readonly [number, number];
  logX?: boolean;
  logY?: boolean;
  /** Draws x from high to low, as a temperature axis on an HR diagram. */
  reverseX?: boolean;
  /** Gives both axes the same scale, widening x, so a circle on the sky stays round. */
  equal?: boolean;
}

export interface SvgNode {
  tag: string;
  attrs: Record<string, string | number>;
  children?: readonly (SvgNode | string)[];
}

export interface Palette {
  ink: string;
  muted: string;
  grid: string;
  back: string;
  tones: readonly [string, string, string, string];
}

/** Theme colors for the window; they follow light, dark, and contrast themes. */
export const SCREEN: Palette = {
  ink: 'var(--color-text-primary)',
  muted: 'var(--color-text-secondary)',
  grid: 'var(--color-border-subtle)',
  back: 'transparent',
  tones: [
    'var(--color-accent-primary)',
    'var(--color-accent-clay)',
    'var(--color-accent-night)',
    'var(--color-accent-dusk)',
  ],
};

const light = tokens.color.light;

/** The light palette for a picture inserted into a page. */
export const PRINT: Palette = {
  ink: light.text.primary,
  muted: light.text.secondary,
  grid: light.border.subtle,
  back: light.surface.page,
  tones: [light.accent.primary, light.accent.clay, light.accent.night, light.accent.dusk],
};

const W = 480;
const H = 300;
const M = { left: 62, right: 16, top: 14, bottom: 44 };
const DASH: Record<SeriesKind, string> = { line: '', dash: '6 4', sticks: '', dots: '' };

/** Round tick values covering [lo, hi]. */
export function ticks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * power >= raw) ?? 10) * power;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step)
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function extent(values: number[], fallback: readonly [number, number]): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [fallback[0], fallback[1]];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= pad;
    hi += pad;
  }
  return [lo, hi];
}

function label(value: number): string {
  if (value === 0) return '0';
  const a = Math.abs(value);
  if (a >= 1e5 || a < 1e-3) return value.toExponential(1).replace('e+', 'e');
  return String(Number(value.toPrecision(4)));
}

interface Axes {
  sx(x: number): number;
  sy(y: number): number;
  xr: [number, number];
  yr: [number, number];
}

function axes(spec: PlotSpec): Axes {
  const pts = spec.series.flatMap((s) => s.points);
  const fx = (v: number) => (spec.logX ? Math.log10(v) : v);
  const fy = (v: number) => (spec.logY ? Math.log10(v) : v);
  const xs = pts.map(([x]) => fx(x));
  const ys = [...pts.map(([, y]) => fy(y)), ...(spec.levels ?? []).map((l) => fy(l.y))];
  if (spec.series.some((s) => s.kind === 'sticks') && !spec.logY) ys.push(0);
  const xr = spec.x ? ([fx(spec.x[0]), fx(spec.x[1])] as [number, number]) : extent(xs, [0, 1]);
  const yr = spec.y ? ([fy(spec.y[0]), fy(spec.y[1])] as [number, number]) : extent(ys, [0, 1]);
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;
  if (spec.equal) {
    const half = ((yr[1] - yr[0]) * pw) / ph / 2;
    const mid = (xr[0] + xr[1]) / 2;
    if (half > (xr[1] - xr[0]) / 2) [xr[0], xr[1]] = [mid - half, mid + half];
  }
  return {
    xr,
    yr,
    sx: (x) => M.left + ((spec.reverseX ? xr[1] - fx(x) : fx(x) - xr[0]) / (xr[1] - xr[0])) * pw,
    sy: (y) => M.top + ph - ((fy(y) - yr[0]) / (yr[1] - yr[0])) * ph,
  };
}

const n = (v: number) => Math.round(v * 100) / 100;
const text = (x: number, y: number, body: string, attrs: Record<string, string | number>): SvgNode => ({
  tag: 'text',
  attrs: { x: n(x), y: n(y), ...attrs },
  children: [body],
});

function frame(a: Axes, spec: PlotSpec, p: Palette): SvgNode[] {
  const out: SvgNode[] = [];
  const unlog = (v: number, log?: boolean) => (log ? 10 ** v : v);
  for (const tx of ticks(a.xr[0], a.xr[1])) {
    const x = a.sx(unlog(tx, spec.logX));
    out.push({ tag: 'line', attrs: { x1: n(x), x2: n(x), y1: M.top, y2: H - M.bottom, stroke: p.grid } });
    out.push(text(x, H - M.bottom + 16, label(unlog(tx, spec.logX)), { 'text-anchor': 'middle', fill: p.muted }));
  }
  for (const ty of ticks(a.yr[0], a.yr[1])) {
    const y = a.sy(unlog(ty, spec.logY));
    out.push({ tag: 'line', attrs: { x1: M.left, x2: W - M.right, y1: n(y), y2: n(y), stroke: p.grid } });
    out.push(text(M.left - 6, y + 4, label(unlog(ty, spec.logY)), { 'text-anchor': 'end', fill: p.muted }));
  }
  out.push({
    tag: 'rect',
    attrs: {
      x: M.left,
      y: M.top,
      width: W - M.left - M.right,
      height: H - M.top - M.bottom,
      fill: 'none',
      stroke: p.muted,
    },
  });
  out.push(text((M.left + W - M.right) / 2, H - 8, spec.xLabel, { 'text-anchor': 'middle', fill: p.ink }));
  out.push(
    text(14, (M.top + H - M.bottom) / 2, spec.yLabel, {
      'text-anchor': 'middle',
      fill: p.ink,
      transform: `rotate(-90 14 ${n((M.top + H - M.bottom) / 2)})`,
    }),
  );
  return out;
}

const inside = (x: number, y: number) =>
  Number.isFinite(x) &&
  Number.isFinite(y) &&
  x >= M.left - 0.5 &&
  x <= W - M.right + 0.5 &&
  y >= M.top - 0.5 &&
  y <= H - M.bottom + 0.5;

function seriesNodes(a: Axes, s: Series, p: Palette): SvgNode[] {
  const colour = p.tones[(s.tone ?? 0) % 4]!;
  const kind = s.kind ?? 'line';
  const pts = s.points.map(([x, y]) => [a.sx(x), a.sy(y)] as const);
  if (kind === 'sticks') {
    const base = a.sy(Math.max(0, a.yr[0]));
    return pts
      .filter(([x, y]) => inside(x, y))
      .map(([x, y]) => ({
        tag: 'line',
        attrs: { x1: n(x), x2: n(x), y1: n(base), y2: n(y), stroke: colour, 'stroke-width': 2 },
      }));
  }
  if (kind === 'dots') {
    return pts.flatMap(([x, y], i): SvgNode[] => {
      if (!inside(x, y)) return [];
      const r = s.sizes?.[i] ?? 3;
      return [{ tag: 'circle', attrs: { cx: n(x), cy: n(y), r: n(r), fill: colour } }];
    });
  }
  let d = '';
  let pen = false;
  for (const [x, y] of pts) {
    if (!inside(x, y)) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${n(x)} ${n(y)}`;
    pen = true;
  }
  const attrs: Record<string, string | number> = { d, fill: 'none', stroke: colour, 'stroke-width': 2 };
  if (DASH[kind]) attrs['stroke-dasharray'] = DASH[kind];
  return d ? [{ tag: 'path', attrs }] : [];
}

interface Label {
  x: number;
  y: number;
  r: number;
  body: string;
  /** 0: a name that is always drawn; 1: a name that may be dropped; 2: a muted tag that may be dropped. */
  rank: number;
}

/** About the width of one 11 px character. */
const CHAR = 6;

/**
 * Writes the dots' names and tags so none covers another: each tries beside, above, and below its dot. The names that
 * must stay are placed first; a droppable label that finds no free place is left out.
 */
function labelNodes(a: Axes, series: readonly Series[], p: Palette): SvgNode[] {
  const labels: Label[] = [];
  for (const s of series) {
    if ((s.kind ?? 'line') !== 'dots') continue;
    s.points.forEach(([px, py], i) => {
      const x = a.sx(px);
      const y = a.sy(py);
      if (!inside(x, y)) return;
      const r = s.sizes?.[i] ?? 3;
      const name = s.names?.[i];
      const tag = s.tags?.[i];
      if (name) labels.push({ x, y, r, body: name, rank: s.minorNames ? 1 : 0 });
      if (tag) labels.push({ x, y, r, body: tag, rank: 2 });
    });
  }
  labels.sort((l, m) => l.rank - m.rank);
  // The legend's rows are taken first.
  const placed: [number, number, number, number][] = series
    .filter((s) => s.label)
    .map((s, i) => [M.left + 8, M.top + 3 + i * 16, M.left + 34 + s.label!.length * CHAR, M.top + 16 + i * 16]);
  const free = (b: [number, number, number, number]) =>
    placed.every(([x1, y1, x2, y2]) => b[2] <= x1 || b[0] >= x2 || b[3] <= y1 || b[1] >= y2);
  const out: SvgNode[] = [];
  for (const l of labels) {
    const w = l.body.length * CHAR;
    // Baselines and left edges: beside, above, below (a tag starts below, centered).
    const spots: [number, number][] =
      l.rank === 2
        ? [
            [l.x - w / 2, l.y + l.r + 10],
            [l.x - w / 2, l.y - l.r - 3],
            [l.x + l.r + 2, l.y + 4],
          ]
        : [
            [l.x + l.r + 2, l.y + 4],
            [l.x - w / 2, l.y - l.r - 3],
            [l.x - w / 2, l.y + l.r + 10],
          ];
    const boxes = spots.map(([x, y]): [number, number, number, number] => [x, y - 9, x + w, y + 2]);
    let k = boxes.findIndex(free);
    if (k < 0) {
      if (l.rank > 0) continue;
      k = 0;
    }
    placed.push(boxes[k]!);
    const [x, y] = spots[k]!;
    out.push(text(x, y, l.body, { fill: l.rank === 2 ? p.muted : p.ink }));
  }
  return out;
}

function levelNodes(a: Axes, level: Level, p: Palette): SvgNode[] {
  const y = a.sy(level.y);
  if (!inside(M.left, y)) return [];
  const x1 = level.from === undefined ? M.left : Math.max(M.left, a.sx(level.from));
  const x2 = level.to === undefined ? W - M.right : Math.min(W - M.right, a.sx(level.to));
  const colour = p.tones[(level.tone ?? 2) % 4]!;
  return [
    { tag: 'line', attrs: { x1: n(x1), x2: n(x2), y1: n(y), y2: n(y), stroke: colour, 'stroke-dasharray': '2 3' } },
    text(x2 - 4, y - 3, level.label, { 'text-anchor': 'end', fill: p.ink }),
  ];
}

function legend(spec: PlotSpec, p: Palette): SvgNode[] {
  const named = spec.series.filter((s) => s.label);
  return named.map((s, i) => {
    const y = M.top + 14 + i * 16;
    const colour = p.tones[(s.tone ?? 0) % 4]!;
    const dash = DASH[s.kind ?? 'line'];
    return {
      tag: 'g',
      attrs: {},
      children: [
        {
          tag: 'line',
          attrs: {
            x1: M.left + 8,
            x2: M.left + 28,
            y1: y - 4,
            y2: y - 4,
            stroke: colour,
            'stroke-width': 2,
            ...(dash ? { 'stroke-dasharray': dash } : {}),
          },
        },
        text(M.left + 34, y, s.label!, { fill: p.ink }),
      ],
    };
  });
}

/** The plot as an SVG tree in a palette. */
export function plotTree(spec: PlotSpec, p: Palette): SvgNode {
  const a = axes(spec);
  return {
    tag: 'svg',
    attrs: {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `0 0 ${W} ${H}`,
      width: W,
      height: H,
      'font-size': 11,
      'font-family': tokens.font.ui,
    },
    children: [
      { tag: 'title', attrs: {}, children: [spec.title] },
      { tag: 'rect', attrs: { x: 0, y: 0, width: W, height: H, fill: p.back } },
      ...frame(a, spec, p),
      ...(spec.levels ?? []).flatMap((level) => levelNodes(a, level, p)),
      ...spec.series.flatMap((s) => seriesNodes(a, s, p)),
      ...labelNodes(a, spec.series, p),
      ...legend(spec, p),
    ],
  };
}

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** An SVG tree as markup. */
export function svgMarkup(node: SvgNode | string): string {
  if (typeof node === 'string') return escape(node);
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escape(String(v))}"`)
    .join('');
  const body = (node.children ?? []).map(svgMarkup).join('');
  return `<${node.tag}${attrs}>${body}</${node.tag}>`;
}
