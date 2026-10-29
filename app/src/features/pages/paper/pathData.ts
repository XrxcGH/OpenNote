// Reads back the path data the paper generator writes, for tests: lines as "M x yL x y" and dots as "M x yh0".

export type Seg = readonly [x1: number, y1: number, x2: number, y2: number];

const NUMBER = '(-?\\d+(?:\\.\\d+)?)';

export function segments(d: string): Seg[] {
  const pattern = new RegExp(`M${NUMBER} ${NUMBER}L${NUMBER} ${NUMBER}`, 'g');
  return [...d.matchAll(pattern)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const);
}

export function points(d: string): [number, number][] {
  const pattern = new RegExp(`M${NUMBER} ${NUMBER}h0`, 'g');
  return [...d.matchAll(pattern)].map((m) => [Number(m[1]), Number(m[2])]);
}

export const horizontal = (segs: readonly Seg[]) => segs.filter((s) => s[1] === s[3]);
export const vertical = (segs: readonly Seg[]) => segs.filter((s) => s[0] === s[2]);
export const leaning = (segs: readonly Seg[]) => segs.filter((s) => s[0] !== s[2] && s[1] !== s[3]);
