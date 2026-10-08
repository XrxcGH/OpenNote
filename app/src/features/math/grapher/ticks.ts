// Axis ticks and grid lines. A major tick sits at a "nice" step (1, 2, or 5 times a power of ten), and minor ticks
// divide each step evenly. Positions are in pixels along the axis, so a renderer can draw them directly.

import type { Size, Viewport } from './types';
import { toPixel } from './viewport';

export interface Tick {
  /** The graph coordinate. */
  readonly value: number;
  /** Pixels from the left edge (x axis) or the top edge (y axis). */
  readonly position: number;
  /** The text for a major tick, and an empty string for a minor one. */
  readonly label: string;
  readonly major: boolean;
}

export interface TickSteps {
  readonly step: number;
  /** How many minor intervals fit in one step. */
  readonly divisions: number;
}

/** The pixel gap to aim for between major ticks on each axis. */
export interface TickSpacing {
  readonly x: number;
  readonly y: number;
}

/** Labels on x are wider than on y, so x gets more room. */
export const DEFAULT_TICK_SPACING: TickSpacing = { x: 88, y: 56 };

/** The most ticks one axis will ever have, so a huge zoom range can't stall the page. */
const MAX_TICKS = 400;

/** The largest "nice" step that is at least about `rawStep`, and how many minor intervals it divides into. */
export function niceSteps(rawStep: number): TickSteps {
  const exponent = Math.floor(Math.log10(rawStep));
  const mantissa = rawStep / Math.pow(10, exponent);
  const [nice, divisions] = mantissa < 1.5 ? [1, 5] : mantissa < 3.5 ? [2, 4] : mantissa < 7.5 ? [5, 5] : [10, 5];
  return { step: Number((nice * Math.pow(10, exponent)).toPrecision(12)), divisions };
}

/** Text for a tick: fixed decimals for ordinary sizes, and exponent form for very big or small values. */
export function formatTick(value: number, step: number): string {
  if (value === 0) return '0';
  const stepPower = Math.floor(Math.log10(step));
  if (Math.abs(value) >= 1e7 || stepPower < -4) return value.toExponential().replace('e+', 'e');
  const text = value.toFixed(Math.max(0, -stepPower));
  return text === '-0' ? '0' : text;
}

function tickValue(index: number, step: number): number {
  return Number((index * step).toPrecision(12));
}

/**
 * The ticks for one axis from `min` to `max`, drawn over `length` pixels, aiming for `spacing` pixels between
 * major ticks. `flip` measures positions from the far end, as the y axis needs.
 */
export function axisTicks(min: number, max: number, length: number, spacing: number, flip = false): Tick[] {
  const span = max - min;
  if (!(span > 0) || !(length > 0)) return [];
  const { step, divisions } = niceSteps((span / length) * spacing);
  const minor = step / divisions;
  const first = Math.ceil(min / minor - 1e-9);
  const last = Math.floor(max / minor + 1e-9);
  // Past 2^53 a tick index can no longer count by one, so the view is too narrow for its place to tick at all.
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return [];
  const count = last - first;
  if (count > MAX_TICKS * divisions) return [];
  const ticks: Tick[] = [];
  for (let i = 0; i <= count; i += 1) {
    const index = first + i;
    const value = tickValue(index, minor);
    const major = index % divisions === 0;
    const offset = ((value - min) / span) * length;
    ticks.push({
      value,
      position: flip ? length - offset : offset,
      label: major ? formatTick(value, step) : '',
      major,
    });
  }
  return ticks;
}

/** Where an axis line is drawn: at its zero, or pinned to an edge of the view when zero is out of view. */
export interface AxisLine {
  readonly pixel: number;
  /** Which edge the line is stuck to, or null when zero is in view. */
  readonly edge: 'min' | 'max' | null;
}

function axisLine(pixel: number, length: number): AxisLine {
  if (pixel < 0) return { pixel: 0, edge: 'min' };
  if (pixel > length) return { pixel: length, edge: 'max' };
  return { pixel, edge: null };
}

export interface Grid {
  /** Ticks along x. Each one is a vertical grid line. */
  readonly x: readonly Tick[];
  /** Ticks along y. Each one is a horizontal grid line. */
  readonly y: readonly Tick[];
  /** The horizontal line at y = 0, with `edge` 'min' when it is stuck to the top and 'max' to the bottom. */
  readonly xAxis: AxisLine;
  /** The vertical line at x = 0, with `edge` 'min' when it is stuck to the left and 'max' to the right. */
  readonly yAxis: AxisLine;
}

/** The grid lines, ticks, and axis lines for a viewport drawn in `size` pixels. */
export function computeGrid(view: Viewport, size: Size, spacing: TickSpacing = DEFAULT_TICK_SPACING): Grid {
  const origin = toPixel(view, size, { x: 0, y: 0 });
  return {
    x: axisTicks(view.xMin, view.xMax, size.width, spacing.x),
    y: axisTicks(view.yMin, view.yMax, size.height, spacing.y, true),
    xAxis: axisLine(origin.y, size.height),
    yAxis: axisLine(origin.x, size.width),
  };
}
