// checks-disable-file length: SVG attribute strings are written as one line each

// Plots and pictures the tools draw, as SVG text built from numbers alone. In the window they use the theme's tokens,
// so they follow light, dark, and contrast themes; put on a page they use the light theme's values, since a picture
// keeps its colors wherever it goes.
import { tokens } from '../../../../theme/tokens';
import { escapeXml, numberText } from './format';
import type { Plot } from './spec';

export interface Palette {
  readonly text: string;
  readonly muted: string;
  readonly grid: string;
  readonly surface: string;
  readonly font: string;
  readonly pen: string;
  readonly accent: string;
}

const pen = (name: string) =>
  tokens.ink.pens.find((one) => one.name === name)?.light ?? tokens.color.light.text.primary;

export const SCREEN: Palette = {
  text: 'var(--color-text-primary)',
  muted: 'var(--color-text-secondary)',
  grid: 'var(--color-border-subtle)',
  surface: 'var(--color-surface-page)',
  font: 'var(--font-ui)',
  pen: 'var(--ink-indigo)',
  accent: 'var(--ink-brick)',
};

export const PAGE: Palette = {
  text: tokens.color.light.text.primary,
  muted: tokens.color.light.text.secondary,
  grid: tokens.color.light.border.subtle,
  surface: tokens.color.light.surface.page,
  font: tokens.font.ui,
  pen: pen('Indigo'),
  accent: pen('Brick'),
};

export const W = 480;
export const H = 300;

export const svgWrap = (parts: readonly string[], palette: Palette, width = W, height = H, label = ''): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
  `font-family="${escapeXml(palette.font)}" role="img" aria-label="${escapeXml(label)}">` +
  `<rect width="${width}" height="${height}" fill="${palette.surface}"/>${parts.join('')}</svg>`;

/** Round tick values from `lo` to `hi`, about `count` of them. */
export function ticks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step)
    out.push(Number(v.toPrecision(12)));
  return out;
}

const fixed = (n: number) => n.toFixed(1);

export interface PlotLabels {
  readonly x: string;
  readonly y: string;
  /** What the picture shows, for people who cannot see it. */
  readonly alt: string;
}

/** A line plot or a histogram with labeled axes, as SVG text. */
export function plotSvg(plot: Plot, labels: PlotLabels, palette: Palette): string {
  const left = 56;
  const right = 14;
  const top = 14;
  const bottom = 44;
  const xs: number[] = [];
  const ys: number[] = [0];
  if (plot.kind === 'bars') {
    for (const bar of plot.bars ?? []) {
      xs.push(bar.from, bar.to);
      ys.push(bar.count);
    }
  } else {
    for (const [x, y] of plot.points) {
      xs.push(x);
      ys.push(y);
    }
  }
  for (const mark of plot.marks ?? []) xs.push(mark);
  const xLo = xs.length === 0 ? 0 : Math.min(...xs);
  const xHi = xs.length === 0 ? 1 : Math.max(...xs);
  const yLo = plot.kind === 'bars' ? 0 : Math.min(...ys);
  const yHi = Math.max(...ys);
  const xSpan = xHi > xLo ? xHi - xLo : 1;
  const ySpan = yHi > yLo ? yHi - yLo : 1;
  const sx = (x: number) => left + ((x - xLo) / xSpan) * (W - left - right);
  const sy = (y: number) => H - bottom - ((y - yLo) / ySpan) * (H - top - bottom);
  const parts: string[] = [];
  for (const v of ticks(yLo, yHi, 5)) {
    parts.push(
      `<line x1="${left}" x2="${W - right}" y1="${fixed(sy(v))}" y2="${fixed(sy(v))}" stroke="${palette.grid}" stroke-width="1"/>`,
      `<text x="${left - 6}" y="${fixed(sy(v) + 4)}" text-anchor="end" font-size="11" fill="${palette.muted}">${escapeXml(numberText(v, 3))}</text>`,
    );
  }
  for (const v of ticks(xLo, xHi, 5)) {
    parts.push(
      `<line x1="${fixed(sx(v))}" x2="${fixed(sx(v))}" y1="${H - bottom}" y2="${H - bottom + 4}" stroke="${palette.muted}"/>`,
      `<text x="${fixed(sx(v))}" y="${H - bottom + 17}" text-anchor="middle" font-size="11" fill="${palette.muted}">${escapeXml(numberText(v, 3))}</text>`,
    );
  }
  parts.push(
    `<line x1="${left}" x2="${W - right}" y1="${H - bottom}" y2="${H - bottom}" stroke="${palette.muted}"/>`,
    `<line x1="${left}" x2="${left}" y1="${top}" y2="${H - bottom}" stroke="${palette.muted}"/>`,
  );
  if (plot.kind === 'bars') {
    for (const bar of plot.bars ?? []) {
      const w = Math.max(1, sx(bar.to) - sx(bar.from) - 1);
      parts.push(
        `<rect x="${fixed(sx(bar.from))}" y="${fixed(sy(bar.count))}" width="${fixed(w)}" height="${fixed(H - bottom - sy(bar.count))}" fill="${palette.pen}" opacity="0.8"/>`,
      );
    }
  } else if (plot.points.length > 0) {
    const d = plot.points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${fixed(sx(x))} ${fixed(sy(y))}`).join('');
    parts.push(`<path d="${d}" fill="none" stroke="${palette.pen}" stroke-width="2" stroke-linejoin="round"/>`);
  }
  for (const mark of plot.marks ?? []) {
    parts.push(
      `<line x1="${fixed(sx(mark))}" x2="${fixed(sx(mark))}" y1="${top}" y2="${H - bottom}" stroke="${palette.accent}" stroke-width="1.5" stroke-dasharray="5 3"/>`,
    );
  }
  parts.push(
    `<text x="${(left + W - right) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" fill="${palette.text}">${escapeXml(labels.x)}</text>`,
    `<text transform="translate(14 ${(top + H - bottom) / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="${palette.text}">${escapeXml(labels.y)}</text>`,
  );
  return svgWrap(parts, palette, W, H, labels.alt);
}
