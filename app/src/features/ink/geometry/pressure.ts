// Pressure curves (design 5.8). A curve is a cubic Bezier from (0, 0) to (1, 1) with two control points. It becomes a
// lookup table when the setting changes, so the pen handler only does one interpolation per sample.

import type { InkPoint } from './types';

export type PressureCurveKind = 'soft' | 'normal' | 'firm' | 'custom';

/** The two control points of the curve: input pressure on x, output pressure on y. */
export interface CurveControls {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface PressureSettings {
  readonly curve: PressureCurveKind;
  /** The controls for `custom`. Ignored by the presets. */
  readonly custom?: CurveControls;
  /** The lowest output, 0 to 0.6, so light strokes stay visible. Defaults to 0.2. */
  readonly minimum?: number;
}

export const PRESSURE_PRESETS: Record<Exclude<PressureCurveKind, 'custom'>, CurveControls> = {
  soft: { x1: 0.15, y1: 0.45, x2: 0.5, y2: 0.95 },
  normal: { x1: 0.33, y1: 0.33, x2: 0.67, y2: 0.67 },
  firm: { x1: 0.5, y1: 0.05, x2: 0.85, y2: 0.55 },
};

export const DEFAULT_MINIMUM_PRESSURE = 0.2;
export const MAX_MINIMUM_PRESSURE = 0.6;

/** Entries in a lookup table: inputs 0, 1/256, ... 1. */
export const TABLE_SIZE = 257;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keeps a custom curve from ever going down: the control points only rise and stay inside the unit box. */
export function sanitizeControls(c: CurveControls): CurveControls {
  const x1 = clamp(c.x1, 0, 1);
  const y1 = clamp(c.y1, 0, 1);
  return { x1, y1, x2: clamp(c.x2, x1, 1), y2: clamp(c.y2, y1, 1) };
}

function bezier(a: number, b: number, s: number): number {
  const u = 1 - s;
  return 3 * u * u * s * a + 3 * u * s * s * b + s * s * s;
}

/** The curve's output for each of the 257 evenly spaced inputs, before the minimum. */
function sampleCurve(c: CurveControls): Float32Array {
  const out = new Float32Array(TABLE_SIZE);
  for (let i = 0; i < TABLE_SIZE; i++) {
    const x = i / (TABLE_SIZE - 1);
    let lo = 0;
    let hi = 1;
    for (let step = 0; step < 24; step++) {
      const mid = (lo + hi) / 2;
      if (bezier(c.x1, c.x2, mid) < x) lo = mid;
      else hi = mid;
    }
    out[i] = bezier(c.y1, c.y2, (lo + hi) / 2);
  }
  out[0] = 0;
  out[TABLE_SIZE - 1] = 1;
  return out;
}

/** The lookup table for a pen's pressure settings. The minimum lifts the whole curve: out = min + (1 - min) * curve. */
export function buildPressureTable(settings: PressureSettings): Float32Array {
  const controls =
    settings.curve === 'custom'
      ? sanitizeControls(settings.custom ?? PRESSURE_PRESETS.normal)
      : PRESSURE_PRESETS[settings.curve];
  const minimum = clamp(settings.minimum ?? DEFAULT_MINIMUM_PRESSURE, 0, MAX_MINIMUM_PRESSURE);
  const table = sampleCurve(controls);
  for (let i = 0; i < TABLE_SIZE; i++) table[i] = minimum + (1 - minimum) * table[i];
  return table;
}

/** Looks a pressure up in a table, interpolating between entries. */
export function mapPressure(table: Float32Array, pressure: number): number {
  const position = clamp(pressure, 0, 1) * (TABLE_SIZE - 1);
  const index = Math.min(TABLE_SIZE - 2, Math.floor(position));
  const fraction = position - index;
  return table[index] + (table[index + 1] - table[index]) * fraction;
}

/** Applies a table to every point that has pressure. Points without pressure (a mouse) stay without it. */
export function applyPressureTable(points: readonly InkPoint[], table: Float32Array): InkPoint[] {
  return points.map((p) => (p.pressure === undefined ? p : { ...p, pressure: mapPressure(table, p.pressure) }));
}
