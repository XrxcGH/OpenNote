// The kit's plots, built as SVG text from numbers alone: time responses, Bode plots, Nyquist curves, root loci,
// pole and zero maps, distributions, and control charts. Axes are linear or logarithmic, and a plane plot keeps equal scales
// so angles read true. In the window the colors are the theme's tokens, so they follow light, dark, and contrast
// themes; on a page they are the light theme's values, since a picture keeps its colors wherever it goes.
import { tokens } from '../../../../theme/tokens';
import { fmt } from '../lib/tf';

export interface Palette {
  readonly text: string;
  readonly muted: string;
  readonly grid: string;
  readonly surface: string;
  readonly font: string;
  readonly pens: readonly string[];
}

const pen = (name: string) =>
  tokens.ink.pens.find((one) => one.name === name)?.light ?? tokens.color.light.text.primary;

export const SCREEN: Palette = {
  text: 'var(--color-text-primary)',
  muted: 'var(--color-text-secondary)',
  grid: 'var(--color-border-subtle)',
  surface: 'var(--color-surface-page)',
  font: 'var(--font-ui)',
  pens: ['var(--ink-indigo)', 'var(--ink-brick)', 'var(--ink-fern)', 'var(--ink-plum)', 'var(--ink-amber)'],
};

export const PAGE: Palette = {
  text: tokens.color.light.text.primary,
  muted: tokens.color.light.text.secondary,
  grid: tokens.color.light.border.subtle,
  surface: tokens.color.light.surface.page,
  font: tokens.font.ui,
  pens: ['Indigo', 'Brick', 'Fern', 'Plum', 'Amber'].map(pen),
};

export type Point = readonly [number, number];

export interface Series {
  /** The series' name under the tool's plot strings, shown in the legend; empty for none. */
  readonly id: string;
  readonly points: readonly Point[];
  /** How the points are drawn. A NaN breaks a line. */
  readonly style?: 'line' | 'dash' | 'stairs' | 'stems' | 'bars' | 'markers';
  readonly marker?: 'x' | 'o' | 'dot';
  readonly pen?: number;
  /** Shades the area between the line and y = 0. */
  readonly fill?: boolean;
}

export interface Axis {
  /** The axis name under the tool's plot strings. */
  readonly label: string;
  readonly log?: boolean;
  readonly min?: number;
  readonly max?: number;
  /** Ticks with names, such as the states of a chain, in place of numbers. */
  readonly names?: readonly { readonly at: number; readonly text: string }[];
}

export interface Reference {
  readonly at: number;
  readonly pen?: number;
}

export interface PlotSpec {
  /** The plot's title under the tool's plot strings. */
  readonly id: string;
  readonly x: Axis;
  readonly y: Axis;
  readonly series: readonly Series[];
  /** The same scale on both axes, for the s- and z-planes and Nyquist plots. */
  readonly equal?: boolean;
  readonly unitCircle?: boolean;
  readonly hlines?: readonly Reference[];
  readonly vlines?: readonly Reference[];
  /** Short labels at points, written as given (numbers and symbols, not words). */
  readonly labels?: readonly { readonly x: number; readonly y: number; readonly text: string }[];
}

/** A drawing that is not a plot, such as a state diagram: its title under the tool's plot strings and its SVG. */
export interface DrawSpec {
  readonly id: string;
  readonly draw: (palette: Palette, words: DrawWords) => string;
}

export type Picture = PlotSpec | DrawSpec;

export const isDrawing = (picture: Picture): picture is DrawSpec => 'draw' in picture;

export const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const W = 520;
const H = 300;
const M = { left: 58, right: 14, top: 26, bottom: 40 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;

interface Scale {
  readonly lo: number;
  readonly hi: number;
  readonly log: boolean;
}

const tv = (s: Scale, v: number) => (s.log ? Math.log10(v) : v);

function range(values: number[], axis: Axis, log: boolean): Scale {
  const vs = values.filter((v) => Number.isFinite(v) && (!log || v > 0)).map((v) => (log ? Math.log10(v) : v));
  let lo = axis.min !== undefined ? (log ? Math.log10(axis.min) : axis.min) : Math.min(...vs);
  let hi = axis.max !== undefined ? (log ? Math.log10(axis.max) : axis.max) : Math.max(...vs);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = log ? [-1, 1] : [-1, 1];
  if (hi - lo < 1e-12 * Math.max(1, Math.abs(hi))) {
    const pad = log ? 0.5 : Math.max(1, Math.abs(hi) * 0.1);
    lo -= pad;
    hi += pad;
  } else if (!log) {
    const pad = (hi - lo) * 0.05;
    if (axis.min === undefined) lo -= pad;
    if (axis.max === undefined) hi += pad;
  }
  return { lo, hi, log };
}

/** Round tick values between lo and hi, about `count` of them. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => span / s <= count + 1) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step)
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function ticks(s: Scale): number[] {
  if (!s.log) return niceTicks(s.lo, s.hi);
  const out: number[] = [];
  for (let e = Math.ceil(s.lo - 1e-9); e <= s.hi + 1e-9; e += 1) out.push(e);
  return out;
}

const tickText = (s: Scale, v: number) => (s.log ? `10${superscript(v)}` : fmt(v, 4));

function superscript(n: number): string {
  return String(n)
    .replace('-', '⁻')
    .split('')
    .map((d) => ('0123456789'.includes(d) ? '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)] : d))
    .join('');
}

/** Makes the two scales match units per pixel, widening the narrower one about its middle. */
function equalize(x: Scale, y: Scale): [Scale, Scale] {
  const per = Math.max((x.hi - x.lo) / PW, (y.hi - y.lo) / PH);
  const mx = (x.lo + x.hi) / 2;
  const my = (y.lo + y.hi) / 2;
  return [
    { ...x, lo: mx - (per * PW) / 2, hi: mx + (per * PW) / 2 },
    { ...y, lo: my - (per * PH) / 2, hi: my + (per * PH) / 2 },
  ];
}

const hasBars = (spec: PlotSpec) => spec.series.some((s) => s.style === 'bars');

function scales(spec: PlotSpec): [Scale, Scale] {
  const pts = spec.series.flatMap((s) => s.points);
  const xs = [...pts.map((p) => p[0]), ...(spec.vlines ?? []).map((r) => r.at)];
  const ys = [...pts.map((p) => p[1]), ...(spec.hlines ?? []).map((r) => r.at)];
  if (spec.series.some((s) => s.style === 'bars' || s.style === 'stems' || s.fill)) ys.push(0);
  if (hasBars(spec)) {
    // Bars stand on their x values, so half a bar's spacing is left at each end.
    const sorted = [...new Set(pts.map((p) => p[0]).filter(Number.isFinite))].sort((a, b) => a - b);
    const gap = sorted.length > 1 ? Math.min(...sorted.slice(1).map((x, i) => x - sorted[i])) : 1;
    if (sorted.length) xs.push(sorted[0] - 0.6 * gap, sorted[sorted.length - 1] + 0.6 * gap);
  }
  if (spec.unitCircle) {
    xs.push(-1.1, 1.1);
    ys.push(-1.1, 1.1);
  }
  const x = range(xs, spec.x, Boolean(spec.x.log));
  const y = range(ys, spec.y, Boolean(spec.y.log));
  return spec.equal ? equalize(x, y) : [x, y];
}

const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

export interface DrawWords {
  /** The words for a key under the tool's plot strings. */
  readonly plot: (id: string) => string;
}

/** The plot or drawing as SVG text. */
export function pictureSvg(picture: Picture, palette: Palette, words: DrawWords): string {
  return isDrawing(picture) ? picture.draw(palette, words) : plotSvg(picture, palette, words);
}

/** The plot as SVG text. */
export function plotSvg(spec: PlotSpec, palette: Palette, words: DrawWords): string {
  const [sx, sy] = scales(spec);
  const px = (v: number) => M.left + ((tv(sx, v) - sx.lo) / (sx.hi - sx.lo)) * PW;
  const py = (v: number) => M.top + PH - ((tv(sy, v) - sy.lo) / (sy.hi - sy.lo)) * PH;
  const ok = (p: Point) =>
    Number.isFinite(p[0]) && Number.isFinite(p[1]) && (!sx.log || p[0] > 0) && (!sy.log || p[1] > 0);
  const title = words.plot(spec.id);
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" ` +
      `aria-label="${escapeXml(title)}" font-family="${escapeXml(palette.font)}" font-size="11">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect width="${W}" height="${H}" fill="${palette.surface}"/>`,
    `<defs><clipPath id="plot-area"><rect x="${M.left}" y="${M.top}" width="${PW}" height="${PH}"/></clipPath></defs>`,
  );
  out.push(...axes(sx, sy, palette, words, spec));
  const body: string[] = [];
  const zeroY = sy.log ? M.top + PH : Math.min(M.top + PH, Math.max(M.top, py(0)));
  if (!sx.log && sx.lo < 0 && sx.hi > 0 && !hasBars(spec))
    body.push(line(px(0), M.top, px(0), M.top + PH, palette.muted, 1));
  if (!sy.log && sy.lo < 0 && sy.hi > 0) body.push(line(M.left, py(0), M.left + PW, py(0), palette.muted, 1));
  if (spec.unitCircle) {
    const r = px(1) - px(0);
    body.push(
      `<ellipse cx="${n2(px(0))}" cy="${n2(py(0))}" rx="${n2(r)}" ry="${n2(py(0) - py(1))}" fill="none" ` +
        `stroke="${palette.muted}" stroke-dasharray="4 3"/>`,
    );
  }
  for (const ref of spec.hlines ?? []) {
    body.push(line(M.left, py(ref.at), M.left + PW, py(ref.at), colorOf(palette, ref.pen ?? 1), 1, '5 4'));
  }
  for (const ref of spec.vlines ?? []) {
    body.push(line(px(ref.at), M.top, px(ref.at), M.top + PH, colorOf(palette, ref.pen ?? 1), 1, '5 4'));
  }
  const barXs = [
    ...new Set(spec.series.filter((s) => s.style === 'bars').flatMap((s) => s.points.map((p) => px(p[0])))),
  ]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const barGap = barXs.length > 1 ? Math.min(...barXs.slice(1).map((x, i) => x - barXs[i])) : PW / 4;
  const draw = { px, py, ok, zeroY, barGap };
  spec.series.forEach((s, i) => body.push(...drawSeries(s, colorOf(palette, s.pen ?? i), draw)));
  for (const label of spec.labels ?? []) {
    if (!ok([label.x, label.y])) continue;
    body.push(
      `<text x="${n2(px(label.x) + 4)}" y="${n2(py(label.y) - 4)}" fill="${palette.text}">${escapeXml(label.text)}</text>`,
    );
  }
  out.push(`<g clip-path="url(#plot-area)">${body.join('')}</g>`);
  out.push(...legend(spec, palette, words));
  out.push('</svg>');
  return out.join('');
}

export const colorOf = (palette: Palette, i: number) => palette.pens[i % palette.pens.length];

function line(x1: number, y1: number, x2: number, y2: number, stroke: string, width = 1.5, dash = ''): string {
  return (
    `<line x1="${n2(x1)}" y1="${n2(y1)}" x2="${n2(x2)}" y2="${n2(y2)}" stroke="${stroke}" ` +
    `stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
  );
}

function axes(sx: Scale, sy: Scale, palette: Palette, words: DrawWords, spec: PlotSpec): string[] {
  const out: string[] = [];
  const left = M.left;
  const bottom = M.top + PH;
  out.push(
    `<rect x="${left}" y="${M.top}" width="${PW}" height="${PH}" fill="none" stroke="${palette.grid}"/>`,
    `<text x="${left}" y="16" fill="${palette.text}" font-weight="600">${escapeXml(words.plot(spec.id))}</text>`,
  );
  const xTicks = spec.x.names ?? ticks(sx).map((v) => ({ at: sx.log ? 10 ** v : v, text: tickText(sx, v) }));
  for (const tick of xTicks) {
    const x = left + ((tv(sx, tick.at) - sx.lo) / (sx.hi - sx.lo)) * PW;
    out.push(line(x, M.top, x, bottom, palette.grid, 1));
    out.push(
      `<text x="${n2(x)}" y="${bottom + 14}" text-anchor="middle" fill="${palette.muted}">${escapeXml(tick.text)}</text>`,
    );
  }
  for (const v of ticks(sy)) {
    const y = bottom - ((v - sy.lo) / (sy.hi - sy.lo)) * PH;
    out.push(line(left, y, left + PW, y, palette.grid, 1));
    out.push(
      `<text x="${left - 4}" y="${n2(y + 4)}" text-anchor="end" fill="${palette.muted}">${tickText(sy, v)}</text>`,
    );
  }
  out.push(
    `<text x="${left + PW / 2}" y="${H - 6}" text-anchor="middle" fill="${palette.text}">${escapeXml(words.plot(spec.x.label))}</text>`,
    `<text transform="translate(12 ${M.top + PH / 2}) rotate(-90)" text-anchor="middle" fill="${palette.text}">` +
      `${escapeXml(words.plot(spec.y.label))}</text>`,
  );
  return out;
}

interface Draw {
  readonly px: (v: number) => number;
  readonly py: (v: number) => number;
  readonly ok: (p: Point) => boolean;
  readonly zeroY: number;
  /** The spacing of bars in pixels. */
  readonly barGap: number;
}

function drawSeries(s: Series, color: string, draw: Draw): string[] {
  const { px, py, ok, zeroY } = draw;
  const style = s.style ?? (s.marker ? 'markers' : 'line');
  const out: string[] = [];
  if (style === 'line' || style === 'dash' || style === 'stairs') {
    const runs: Point[][] = [[]];
    s.points.forEach((p, i) => {
      if (!ok(p)) {
        if (runs[runs.length - 1].length) runs.push([]);
        return;
      }
      const run = runs[runs.length - 1];
      const prev = s.points[i - 1];
      if (style === 'stairs' && run.length && prev && ok(prev)) run.push([p[0], prev[1]]);
      run.push(p);
    });
    for (const run of runs.filter((r) => r.length > 1)) {
      const d = run.map((p, i) => `${i ? 'L' : 'M'}${n2(px(p[0]))} ${n2(py(p[1]))}`).join('');
      if (s.fill) {
        const first = run[0];
        const last = run[run.length - 1];
        out.push(
          `<path d="${d}L${n2(px(last[0]))} ${n2(zeroY)}L${n2(px(first[0]))} ${n2(zeroY)}Z" fill="${color}" ` +
            `fill-opacity="0.18" stroke="none"/>`,
        );
      }
      out.push(
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.75"${style === 'dash' ? ' stroke-dasharray="6 4"' : ''}/>`,
      );
    }
  }
  if (style === 'stems' || style === 'bars') {
    const pts = s.points.filter(ok);
    for (const p of pts) {
      if (style === 'stems') {
        out.push(line(px(p[0]), zeroY, px(p[0]), py(p[1]), color, 1.5));
        out.push(`<circle cx="${n2(px(p[0]))}" cy="${n2(py(p[1]))}" r="2.5" fill="${color}"/>`);
      } else {
        const w = Math.max(1, draw.barGap * 0.7);
        const top = Math.min(py(p[1]), zeroY);
        out.push(
          `<rect x="${n2(px(p[0]) - w / 2)}" y="${n2(top)}" width="${n2(w)}" height="${n2(Math.abs(zeroY - py(p[1])))}" ` +
            `fill="${color}" fill-opacity="${s.fill ? 0.85 : 0.35}" stroke="${color}"/>`,
        );
      }
    }
  }
  if (s.marker) out.push(...s.points.filter(ok).map((p) => marker(s.marker ?? 'dot', px(p[0]), py(p[1]), color)));
  return out;
}

function marker(kind: 'x' | 'o' | 'dot', x: number, y: number, color: string): string {
  if (kind === 'x') {
    const r = 4.5;
    const d = `M${n2(x - r)} ${n2(y - r)}L${n2(x + r)} ${n2(y + r)}M${n2(x - r)} ${n2(y + r)}L${n2(x + r)} ${n2(y - r)}`;
    return `<path d="${d}" stroke="${color}" stroke-width="2"/>`;
  }
  if (kind === 'o')
    return `<circle cx="${n2(x)}" cy="${n2(y)}" r="4.5" fill="none" stroke="${color}" stroke-width="2"/>`;
  return `<circle cx="${n2(x)}" cy="${n2(y)}" r="2.5" fill="${color}"/>`;
}

function legend(spec: PlotSpec, palette: Palette, words: DrawWords): string[] {
  const named = spec.series.map((s, i) => ({ s, i })).filter(({ s }) => s.id);
  if (named.length < 2 && !named.some(({ s }) => s.marker)) return [];
  // A box at the top right of the plot, one series to a line.
  const texts = named.map(({ s }) => words.plot(s.id));
  const width = 26 + Math.max(...texts.map((text) => text.length)) * 6;
  const x = M.left + PW - width - 6;
  const y = M.top + 6;
  const out = [
    `<rect x="${x}" y="${y}" width="${width}" height="${named.length * 15 + 6}" fill="${palette.surface}" ` +
      `fill-opacity="0.85" stroke="${palette.grid}"/>`,
  ];
  named.forEach(({ s, i }, k) => {
    const color = colorOf(palette, s.pen ?? i);
    const mid = y + 11 + k * 15;
    out.push(
      s.marker
        ? marker(s.marker, x + 12, mid, color)
        : line(x + 6, mid, x + 18, mid, color, 2, s.style === 'dash' ? '4 3' : ''),
      `<text x="${x + 22}" y="${mid + 4}" fill="${palette.text}">${escapeXml(texts[k])}</text>`,
    );
  });
  return out;
}
