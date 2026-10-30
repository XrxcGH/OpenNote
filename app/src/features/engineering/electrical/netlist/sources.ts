// The value of an independent source at a time, and the times at which a source or switch changes abruptly.
import type { Element, Shape } from './parse';

const RAMP = (from: number, to: number, fraction: number): number => from + (to - from) * fraction;

function pulseValue(s: Extract<Shape, { kind: 'pulse' }>, t: number): number {
  if (t < s.td) return s.v1;
  const tt = s.per > 0 ? (t - s.td) % s.per : t - s.td;
  if (tt <= 0) return s.v1;
  if (tt < s.tr) return RAMP(s.v1, s.v2, tt / s.tr);
  if (tt <= s.tr + s.pw) return s.v2;
  if (tt < s.tr + s.pw + s.tf) return RAMP(s.v2, s.v1, (tt - s.tr - s.pw) / s.tf);
  return s.v1;
}

/**
 * The source's value at time t. `initial` means just before t = 0, so a step or pulse that begins at time 0 still
 * shows its earlier level; that is the level the operating point is found at.
 */
export function valueAt(shape: Shape, t: number, initial = false): number {
  switch (shape.kind) {
    case 'dc':
      return shape.value;
    case 'step':
      return initial ? (shape.t0 >= 0 ? shape.v0 : shape.v1) : t > shape.t0 ? shape.v1 : shape.v0;
    case 'pulse':
      return initial && shape.td >= 0 ? shape.v1 : pulseValue(shape, t);
    case 'sin': {
      const at = t < shape.td ? shape.td : t;
      return shape.off + shape.amp * Math.sin(2 * Math.PI * shape.freq * (at - shape.td) + shape.phase);
    }
  }
}

/** Whether a switch conducts at time t (or just before 0 when `initial`). */
export function switchClosed(e: Element, t: number, initial = false): boolean {
  const close = e.tClose ?? 0;
  const open = e.tOpen ?? Infinity;
  const now = initial ? -Number.MIN_VALUE : t;
  return now > close && !(now > open);
}

/** The times in (0, stop) where a source or switch changes slope or jumps. */
export function breakpoints(elements: Element[], stop: number): number[] {
  const points = new Set<number>();
  const add = (t: number) => {
    if (t > 0 && t < stop) points.add(t);
  };
  for (const e of elements) {
    if (e.kind === 'S') {
      add(e.tClose ?? 0);
      if (e.tOpen !== undefined) add(e.tOpen);
    }
    const s = e.source?.shape;
    if (!s) continue;
    if (s.kind === 'step') add(s.t0);
    if (s.kind === 'sin') add(s.td);
    if (s.kind === 'pulse') pulseBreaks(s, stop).forEach(add);
  }
  return [...points].sort((a, b) => a - b);
}

function pulseBreaks(s: Extract<Shape, { kind: 'pulse' }>, stop: number): number[] {
  const out: number[] = [];
  const first = s.td;
  for (let k = 0; k < 10000; k++) {
    const base = first + k * s.per;
    if (base > stop) break;
    out.push(base, base + s.tr, base + s.tr + s.pw, base + s.tr + s.pw + s.tf);
    if (s.per <= 0) break;
  }
  return out;
}
