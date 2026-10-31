// Scale drawings and models, enlarging a sketch, and cutting boards. Lengths are in meters inside; the tool shows
// the student's units at its edge.

export const METERS: Record<string, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  in: 0.0254,
  ft: 0.3048,
  yd: 0.9144,
};

const UNIT_NAMES: Record<string, string> = {
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  meter: 'm',
  meters: 'm',
  metre: 'm',
  metres: 'm',
  in: 'in',
  inch: 'in',
  inches: 'in',
  '"': 'in',
  ft: 'ft',
  foot: 'ft',
  feet: 'ft',
  "'": 'ft',
  yd: 'yd',
};

/** A unit written in a scale or a length ("in", "inches", "ft", "mm"), or null. */
export const unitOf = (word: string): string | null => UNIT_NAMES[word.trim().toLowerCase()] ?? null;

/** Reads a plain number, a decimal, or a fraction such as 1/4 or 3/16. */
export function readFraction(text: string): number | null {
  const t = text.trim();
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(t);
  if (frac) return Number(frac[2]) === 0 ? null : Number(frac[1]) / Number(frac[2]);
  return /^\d*\.?\d+$/.test(t) ? Number(t) : null;
}

export interface Scale {
  /** Real length divided by drawn length: 50 for 1:50. */
  ratio: number;
}

/**
 * Reads a scale: a ratio such as 1:50, or an equation such as "1/4 in = 1 ft", "1 in = 20 ft", "1 cm = 2 m". Feet
 * and inches may be written 1/4" = 1'. Returns null when the text is not a scale.
 */
export function parseScale(text: string): Scale | null {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/\s*=\s*/, '=');
  const ratio = /^(\d*\.?\d+)\s*:\s*(\d*\.?\d+)$/.exec(t);
  if (ratio) {
    const [a, b] = [Number(ratio[1]), Number(ratio[2])];
    return a > 0 && b > 0 ? { ratio: b / a } : null;
  }
  const side = /^((?:\d+\s+)?[\d./]+)\s*([a-z"']+)$/;
  const [left, right] = t.split('=');
  const l = left ? side.exec(left.trim().replace(/-0["']?$/, '')) : null;
  const r = right ? side.exec(right.trim().replace(/-0["']?$/, '')) : null;
  if (!l || !r) return null;
  const [ln, rn] = [readFraction(l[1]!), readFraction(r[1]!)];
  const [lu, ru] = [unitOf(l[2]!), unitOf(r[2]!)];
  if (ln === null || rn === null || !lu || !ru || ln <= 0 || rn <= 0) return null;
  return { ratio: (rn * METERS[ru]!) / (ln * METERS[lu]!) };
}

/** The drawn length of a real length: real / ratio (both in the same unit). */
export const drawn = (real: number, scale: Scale): number => real / scale.ratio;

/** The real length of a drawn length. */
export const real = (onPaper: number, scale: Scale): number => onPaper * scale.ratio;

/** Area shrinks with the square of the ratio, volume with the cube. */
export const areaFactor = (scale: Scale): number => 1 / scale.ratio ** 2;
export const volumeFactor = (scale: Scale): number => 1 / scale.ratio ** 3;

export interface Enlargement {
  /** Factor across the width. */
  widthFactor: number;
  heightFactor: number;
  /** True when the factors agree, so the shape stays the same. */
  uniform: boolean;
  /** The factor that fits inside the target without distortion. */
  fit: number;
}

/** How much to enlarge a sketch to reach a target size. */
export function enlargement(sketchW: number, sketchH: number, targetW: number, targetH: number): Enlargement {
  const widthFactor = targetW / sketchW;
  const heightFactor = targetH / sketchH;
  return {
    widthFactor,
    heightFactor,
    uniform: Math.abs(widthFactor - heightFactor) <= 1e-9 * Math.max(widthFactor, heightFactor),
    fit: Math.min(widthFactor, heightFactor),
  };
}

export interface CutPiece {
  length: number;
  quantity: number;
}

export interface Board {
  cuts: number[];
  /** The length used, counting the kerf lost between pieces. */
  used: number;
  leftover: number;
}

export interface CutPlan {
  boards: Board[];
  /** Pieces longer than a stock board. */
  tooLong: number[];
  wasteFraction: number;
}

/** First-fit decreasing: the longest pieces go first, each into the first board with room for it and its kerf. */
export function cutList(stock: number, kerf: number, pieces: readonly CutPiece[]): CutPlan {
  const all = pieces.flatMap((p) => Array.from({ length: p.quantity }, () => p.length)).sort((a, b) => b - a);
  const boards: Board[] = [];
  const tooLong: number[] = [];
  for (const length of all) {
    if (length > stock) {
      tooLong.push(length);
      continue;
    }
    // Each cut after the first on a board loses one kerf; the board's own end needs none.
    const board = boards.find((b) => b.used + kerf + length <= stock + 1e-9);
    if (board) {
      board.cuts.push(length);
      board.used += kerf + length;
    } else {
      boards.push({ cuts: [length], used: length, leftover: 0 });
    }
  }
  for (const b of boards) b.leftover = Math.max(0, stock - b.used);
  const total = boards.length * stock;
  const usedLength = boards.reduce((sum, b) => sum + b.cuts.reduce((x, y) => x + y, 0), 0);
  return { boards, tooLong, wasteFraction: total === 0 ? 0 : 1 - usedLength / total };
}
