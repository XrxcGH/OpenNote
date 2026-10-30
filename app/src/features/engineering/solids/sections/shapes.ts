// The library shapes as parts, with the origin at the bottom left of each shape, and the typed lists of parts and
// of centerline points read into parts. The thin-walled open shapes (channel, angle, and Z) also give their
// centerline chain, so the shear center can be found; the others give it by symmetry.
import { typedLines } from '../kit/lines';
import { fail, positive } from '../kit/types';
import type { Placed, Wall } from './engine';

export const SHAPES = ['rect', 'circle', 'tube', 'I', 'T', 'C', 'L', 'Z', 'box'] as const;
export type Shape = (typeof SHAPES)[number];

export interface Dims {
  readonly b: number;
  readonly h: number;
  readonly d: number;
  readonly t: number;
  readonly tf: number;
  readonly tw: number;
}

export interface Built {
  readonly parts: Placed[];
  readonly chain?: Wall[];
  /** The shear center when symmetry gives it: 'centroid', or a point. */
  readonly center?: 'centroid' | { readonly x: number; readonly y: number };
}

const rect = (b: number, h: number, x: number, y: number, hole = false): Placed => ({
  kind: 'rect',
  b,
  h,
  x,
  y,
  ...(hole ? { hole } : {}),
});

const less = (small: number, big: number) => {
  if (!(small < big)) fail('tooThick');
};

export function shapeParts(shape: Shape, dims: Dims): Built {
  const { b, h, d, t } = dims;
  switch (shape) {
    case 'rect':
      return { parts: [rect(positive(b, 'b'), positive(h, 'h'), b / 2, h / 2)], center: 'centroid' };
    case 'circle':
      return { parts: [{ kind: 'circle', d: positive(d, 'd'), x: d / 2, y: d / 2 }], center: 'centroid' };
    case 'tube': {
      positive(d, 'd');
      less(2 * positive(t, 't'), d);
      return {
        parts: [
          { kind: 'circle', d, x: d / 2, y: d / 2 },
          { kind: 'circle', d: d - 2 * t, x: d / 2, y: d / 2, hole: true },
        ],
        center: 'centroid',
      };
    }
    case 'box': {
      [b, h, t].forEach((value, i) => positive(value, ['b', 'h', 't'][i]));
      less(2 * t, Math.min(b, h));
      return { parts: [rect(b, h, b / 2, h / 2), rect(b - 2 * t, h - 2 * t, b / 2, h / 2, true)], center: 'centroid' };
    }
    default:
      return flanged(shape, dims);
  }
}

function flanged(shape: Shape, { b, h, t, tf: tfIn, tw: twIn }: Dims): Built {
  positive(b, 'b');
  positive(h, 'h');
  const [tf, tw] = shape === 'L' ? [positive(t, 't'), t] : [positive(tfIn, 't_f'), positive(twIn, 't_w')];
  if (shape === 'I') {
    less(2 * tf, h);
    less(tw, b + 1e-15);
    return {
      parts: [rect(b, tf, b / 2, h - tf / 2), rect(b, tf, b / 2, tf / 2), rect(tw, h - 2 * tf, b / 2, h / 2)],
      center: 'centroid',
    };
  }
  if (shape === 'T') {
    less(tf, h);
    less(tw, b + 1e-15);
    return {
      parts: [rect(b, tf, b / 2, h - tf / 2), rect(tw, h - tf, b / 2, (h - tf) / 2)],
      center: { x: b / 2, y: h - tf / 2 },
    };
  }
  if (shape === 'C') {
    less(tw, b);
    less(2 * tf, h);
    const flange = b - tw;
    return {
      parts: [
        rect(tw, h, tw / 2, h / 2),
        rect(flange, tf, tw + flange / 2, tf / 2),
        rect(flange, tf, tw + flange / 2, h - tf / 2),
      ],
      chain: [
        { x1: b, y1: h - tf / 2, x2: tw / 2, y2: h - tf / 2, t: tf },
        { x1: tw / 2, y1: h - tf / 2, x2: tw / 2, y2: tf / 2, t: tw },
        { x1: tw / 2, y1: tf / 2, x2: b, y2: tf / 2, t: tf },
      ],
    };
  }
  if (shape === 'L') {
    less(tf, b);
    less(tf, h);
    return {
      parts: [rect(tf, h, tf / 2, h / 2), rect(b - tf, tf, tf + (b - tf) / 2, tf / 2)],
      chain: [
        { x1: b, y1: tf / 2, x2: tf / 2, y2: tf / 2, t: tf },
        { x1: tf / 2, y1: tf / 2, x2: tf / 2, y2: h, t: tf },
      ],
      center: { x: tf / 2, y: tf / 2 },
    };
  }
  // Z: the bottom flange runs left from the web and the top flange right, each b wide with the web.
  less(tw, b);
  less(2 * tf, h);
  const web = b - tw / 2;
  return {
    parts: [
      rect(b - tw, tf, (b - tw) / 2, tf / 2),
      rect(tw, h, b - tw / 2, h / 2),
      rect(b - tw, tf, b + (b - tw) / 2, h - tf / 2),
    ],
    chain: [
      { x1: 2 * b - tw, y1: h - tf / 2, x2: web, y2: h - tf / 2, t: tf },
      { x1: web, y1: h - tf / 2, x2: web, y2: tf / 2, t: tw },
      { x1: web, y1: tf / 2, x2: 0, y2: tf / 2, t: tf },
    ],
  };
}

/** The numbers of a typed line, each converted from the shown length unit by `toSi`. */
function numbers(words: readonly string[], toSi: (value: number) => number, line: number): number[] {
  return words.map((word) => {
    const value = Number(word);
    if (word === '' || !Number.isFinite(value)) fail('partsLine', String(line));
    return toSi(value);
  });
}

const lines = typedLines;

/**
 * Reads parts typed one to a line: "rect b h x y", "circle d x y", or "wall x1 y1 x2 y2 t", with "hole" first for
 * a hole. Rectangles and circles are placed by their centers.
 */
export function readParts(text: string, toSi: (value: number) => number): Placed[] {
  const parts: Placed[] = [];
  for (const { words, line } of lines(text)) {
    const hole = /^(hole|-)$/i.test(words[0]);
    const [kind, ...rest] = hole ? words.slice(1) : words;
    const n = numbers(rest, toSi, line);
    const name = (kind ?? '').toLowerCase();
    if (/^rect(angle)?$/.test(name) && n.length === 4)
      parts.push({ kind: 'rect', b: n[0], h: n[1], x: n[2], y: n[3], ...(hole ? { hole } : {}) });
    else if (name === 'circle' && n.length === 3)
      parts.push({ kind: 'circle', d: n[0], x: n[1], y: n[2], ...(hole ? { hole } : {}) });
    else if (name === 'wall' && n.length === 5)
      parts.push({ kind: 'wall', x1: n[0], y1: n[1], x2: n[2], y2: n[3], t: n[4], ...(hole ? { hole } : {}) });
    else fail('partsLine', String(line));
  }
  if (parts.length === 0) fail('noParts');
  return parts;
}

/** Reads centerline points typed "x y", one to a line, into walls of one thickness. */
export function readChain(text: string, t: number, toSi: (value: number) => number): Wall[] {
  positive(t, 't');
  const points = lines(text).map(({ words, line }) => {
    const n = numbers(words, toSi, line);
    if (n.length !== 2) fail('partsLine', String(line));
    return n;
  });
  if (points.length < 2) fail('fewPoints');
  return points.slice(1).map((p, i) => ({ x1: points[i][0], y1: points[i][1], x2: p[0], y2: p[1], t }));
}

export const wallParts = (walls: readonly Wall[]): Placed[] => walls.map((w) => ({ kind: 'wall', ...w }));
