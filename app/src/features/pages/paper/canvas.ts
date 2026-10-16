// A recorder for paper geometry. The pattern functions draw into it, and it turns the result into SVG path data.

import { EPS, type Rect } from '../pagination/geometry';
import type { PaperLabel, PaperPaths, Weight } from './types';

/** The most lines one family of parallel lines may have, so a bad spacing or a huge custom paper stays cheap. */
export const MAX_TICKS = 4000;

/** Rounds to 0.01 and writes the shortest form: no exponent, no trailing zeros, and 0 instead of -0. */
export function fmt(n: number): string {
  return String(Number(n.toFixed(2)) + 0);
}

const round = (n: number) => Number(fmt(n));

/** The positions origin + k × step, for whole k, that fall within [lo, hi]. */
export function ticks(origin: number, step: number, lo: number, hi: number): number[] {
  const first = Math.ceil((lo - origin - EPS) / step);
  const last = Math.floor((hi - origin + EPS) / step);
  const out: number[] = [];
  for (let k = first; k <= last && out.length < MAX_TICKS; k += 1) out.push(origin + k * step);
  return out;
}

/** The box shrunk to whole cells of `step` from its top-left corner, so a grid ends on a complete square. */
export function wholeCells(box: Rect, step: number): Rect {
  return {
    x: box.x,
    y: box.y,
    w: Math.floor((box.w + EPS) / step) * step,
    h: Math.floor((box.h + EPS) / step) * step,
  };
}

export class Canvas {
  private readonly parts = {
    rule: [] as string[],
    strong: [] as string[],
    dot: [] as string[],
    margin: [] as string[],
  };
  private readonly tintRects: Rect[] = [];
  private readonly texts: PaperLabel[] = [];
  private dy = 0;

  /** Draws everything `fn` adds moved down by `dy`, for patterns that repeat on every sheet. */
  shifted(dy: number, fn: () => void): void {
    const before = this.dy;
    this.dy = before + dy;
    fn();
    this.dy = before;
  }

  line(x1: number, y1: number, x2: number, y2: number, kind: Weight | 'margin' = 'rule'): void {
    this.parts[kind === 'margin' ? 'margin' : kind].push(
      `M${fmt(x1)} ${fmt(y1 + this.dy)}L${fmt(x2)} ${fmt(y2 + this.dy)}`,
    );
  }

  dot(x: number, y: number): void {
    this.parts.dot.push(`M${fmt(x)} ${fmt(y + this.dy)}h0`);
  }

  outline(box: Rect, kind: Weight = 'rule'): void {
    const { x, y, w, h } = box;
    this.line(x, y, x + w, y, kind);
    this.line(x + w, y, x + w, y + h, kind);
    this.line(x + w, y + h, x, y + h, kind);
    this.line(x, y + h, x, y, kind);
  }

  tint(box: Rect): void {
    this.tintRects.push({ x: round(box.x), y: round(box.y + this.dy), w: round(box.w), h: round(box.h) });
  }

  label(label: PaperLabel): void {
    this.texts.push({ ...label, x: round(label.x), y: round(label.y + this.dy) });
  }

  paths(): PaperPaths {
    return {
      rules: this.parts.rule.join(''),
      strong: this.parts.strong.join(''),
      dots: this.parts.dot.join(''),
      margin: this.parts.margin.join(''),
      tints: this.tintRects,
      labels: this.texts,
    };
  }
}
