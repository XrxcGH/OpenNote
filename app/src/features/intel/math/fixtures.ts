// Stroke fixtures for handwritten math, drawn as a hand would: lines with a little wobble, bows, an S for the
// integral. A letter or digit is a small scribble tagged with the character the recognizer would read, because
// reading characters is the handwriting recognizer's work and is not what these tests are about.
import type { Pt } from './geometry';
import type { MathStroke } from './group';

let counter = 0;
const key = (name: string) => `${name}-${(counter += 1)}`;
/** A small deterministic wobble. */
const wobble = (i: number) => Math.sin(i * 12.9898) * 0.25;

const through = (name: string, points: Pt[]): MathStroke => ({ key: key(name), points });

/** A straight stroke from one point to another. */
export function line(name: string, [x0, y0]: Pt, [x1, y1]: Pt, n = 24): MathStroke {
  return through(
    name,
    Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      return [x0 + (x1 - x0) * t + wobble(i), y0 + (y1 - y0) * t + wobble(i + 7)] as Pt;
    }),
  );
}

/** A path through corners, for roots and brackets. */
export function poly(name: string, corners: Pt[], perSide = 12): MathStroke {
  const points: Pt[] = [];
  corners.slice(1).forEach(([x1, y1], k) => {
    const [x0, y0] = corners[k];
    for (let i = 0; i < perSide; i += 1) {
      const t = i / perSide;
      points.push([x0 + (x1 - x0) * t + wobble(i + k), y0 + (y1 - y0) * t + wobble(i + k + 3)]);
    }
  });
  points.push(corners[corners.length - 1]);
  return through(name, points);
}

/** A fraction bar, a minus, or one bar of an equals sign. */
export const bar = (x0: number, x1: number, y: number) => line('bar', [x0, y], [x1, y]);

/** One character as a scribble of the given box, tagged with what it is. */
export function glyph(char: string, x: number, y: number, size = 10, aspect = 0.8): MathStroke {
  const [w, h] = [size * aspect, size];
  const corners: Pt[] = [
    [x, y + h * 0.1],
    [x + w, y],
    [x + w * 0.2, y + h * 0.55],
    [x + w, y + h],
    [x, y + h * 0.9],
  ];
  const stroke = poly(`c:${char}`, corners, 6);
  return { ...stroke, key: `c:${char}` };
}

/** The strokes of a plus sign. */
export function plus(x: number, y: number, size = 10): MathStroke[] {
  const mid = size / 2;
  return [
    { ...line('plus', [x, y + mid], [x + size, y + mid]), key: 'c:+' },
    { ...line('plus', [x + mid, y], [x + mid, y + size]), key: 'c:+' },
  ];
}

/** A tall `(` or `)`. */
export function paren(side: 'open' | 'close', x: number, y: number, h: number): MathStroke {
  const bow = 0.18 * h;
  const points: Pt[] = Array.from({ length: 28 }, (_, i) => {
    const t = i / 27;
    const dx = bow * Math.sin(Math.PI * t) * (side === 'open' ? -1 : 1);
    return [x + dx + wobble(i) * 0.4, y + h * t] as Pt;
  });
  return through(side, points);
}

/** A tall `[` or `]`. */
export function square(side: 'open' | 'close', x: number, y: number, h: number): MathStroke {
  const reach = 0.22 * h;
  return side === 'open'
    ? poly('sq', [
        [x + reach, y],
        [x, y],
        [x, y + h],
        [x + reach, y + h],
      ])
    : poly('sq', [
        [x, y],
        [x + reach, y],
        [x + reach, y + h],
        [x, y + h],
      ]);
}

/** The integral sign. */
export function integral(x: number, y: number, h: number): MathStroke {
  const w = 0.3 * h;
  const points: Pt[] = Array.from({ length: 40 }, (_, i) => {
    const t = i / 39;
    return [x + w / 2 - (w / 2) * Math.sin(2 * Math.PI * t) + 0.12 * h * (0.5 - t), y + h * t] as Pt;
  });
  return through('integral', points);
}

/** A root sign: the tick, the stroke up, and the roof over `roof` units. */
export function radical(x: number, y: number, h: number, roof: number): MathStroke {
  const tick = 0.3 * h;
  return poly('radical', [
    [x, y + 0.55 * h],
    [x + 0.5 * tick, y + 0.5 * h],
    [x + tick, y + h],
    [x + 2 * tick, y],
    [x + 2 * tick + roof, y],
  ]);
}
