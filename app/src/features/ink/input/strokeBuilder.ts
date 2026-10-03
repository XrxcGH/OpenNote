// The stroke builder: raw samples in, a finished stroke out (architecture 6.2, 6.6, and 6.8). It applies the pen's
// pressure curve and the steady pen. It drops samples a record could not tell apart. At the point limit it ends the
// stroke and continues in a new one from the same point. It depends only on the samples, so a recording replays to
// the same stroke, which the steady pen needs (architecture 5.8).

import { MAX_POINTS } from '../../../core/ink/codec';
import { createStabilizer } from '../geometry/stabilizer';
import type { Stabilizer, StabilizerOptions } from '../geometry/stabilizer';
import type { InkPoint, InkTool } from '../geometry/types';
import { POSITION_STEPS_PER_UNIT, PRESSURE_MAX, TILT_STEPS_PER_DEGREE } from '../model/types';
import type { InkStroke } from '../model/types';
import type { Rgba } from '../pens/palette';
import { normalizeSample } from './samples';
import type { RawSample } from './samples';

export interface StrokeBuilderOptions {
  readonly tool: InkTool;
  /** The nominal width in page units. */
  readonly width: number;
  readonly slot: number;
  /** The light-theme color to store. */
  readonly color: Rgba;
  /** The ink block the stroke goes to. */
  readonly block: string;
  /** Makes a stroke ID. The first call is for the first stroke, and the builder calls it again at the point limit. */
  readonly newId: () => string;
  /** Unix milliseconds at time 0 of the sample clock, such as `performance.timeOrigin`. */
  readonly timeOrigin: number;
  /** The pen's lookup table from `buildPressureTable`. Without one, pressure is stored as the device reports it. */
  readonly pressureTable?: Float32Array;
  /** Turns the steady pen on. */
  readonly steady?: StabilizerOptions;
  /** Where a stroke ends and the next one begins. Defaults to the format's limit of 200,000 points. */
  readonly maxPoints?: number;
}

export interface StrokeBuilder {
  /** Adds a sample. Returns the point the ink draws, or null when the sample was dropped. */
  push(sample: RawSample): InkPoint | null;
  /** The points of the stroke in progress, for drawing the live outline. */
  readonly points: readonly InkPoint[];
  /** The stroke in progress as it stands, with its final ID, for a progress record. Null before any point. */
  snapshot(): InkStroke | null;
  /** Strokes that reached the point limit, which are ready to commit. Taking them empties the list. */
  takeCompleted(): InkStroke[];
  /** Ends the stroke. The steady pen catches up to the lift point. Returns every stroke not yet taken. */
  finish(): InkStroke[];
}

/** The quantized form of a point, to tell whether two samples would be the same in a record. */
function quantized(p: InkPoint): number[] {
  return [
    Math.round(p.x * POSITION_STEPS_PER_UNIT),
    Math.round(p.y * POSITION_STEPS_PER_UNIT),
    Math.round((p.pressure ?? 0) * PRESSURE_MAX),
    Math.round((p.tiltX ?? 0) * TILT_STEPS_PER_DEGREE),
    Math.round((p.tiltY ?? 0) * TILT_STEPS_PER_DEGREE),
  ];
}

const sameKey = (a: number[] | null, b: number[]) => a !== null && a.every((v, i) => v === b[i]);

/** True when some point leans: a tilt of zero on every point means the device reports none that is real. */
function hasTilt(points: readonly InkPoint[]): boolean {
  return points.some((p) => (p.tiltX ?? 0) !== 0 || (p.tiltY ?? 0) !== 0);
}

function withoutTilt(point: InkPoint): InkPoint {
  const { tiltX: _x, tiltY: _y, ...rest } = point;
  return rest;
}

class Builder implements StrokeBuilder {
  private readonly limit: number;
  private readonly stabilizer: Stabilizer | null;
  private readonly completed: InkStroke[] = [];
  private id: string;
  private origin: number | null = null;
  private list: InkPoint[] = [];
  private lastKey: number[] | null = null;
  private continued = false;
  private added = 0;

  constructor(private readonly options: StrokeBuilderOptions) {
    this.limit = options.maxPoints ?? MAX_POINTS;
    this.stabilizer = options.steady ? createStabilizer(options.steady) : null;
    this.id = options.newId();
  }

  get points(): readonly InkPoint[] {
    return this.list;
  }

  push(sample: RawSample): InkPoint | null {
    const point = normalizeSample(sample, this.options.pressureTable);
    if (!point) return null;
    return this.append(this.stabilizer ? this.stabilizer.push(point) : point);
  }

  snapshot(): InkStroke | null {
    return this.list.length > 0 ? this.assemble(this.list) : null;
  }

  takeCompleted(): InkStroke[] {
    return this.completed.splice(0, this.completed.length);
  }

  finish(): InkStroke[] {
    const end = this.stabilizer?.finish() ?? null;
    if (end) this.append(end);
    const out = this.takeCompleted();
    if (this.list.length > 0 && (!this.continued || this.added > 0)) out.push(this.assemble(this.list));
    return out;
  }

  private assemble(list: readonly InkPoint[]): InkStroke {
    const { tool, width, slot, color, block, timeOrigin } = this.options;
    const points = hasTilt(list) ? list : list.map(withoutTilt);
    return { id: this.id, tool, width, startTime: timeOrigin + (this.origin ?? 0), points, block, slot, color };
  }

  /** Ends the stroke at the limit and continues from its last point, so the ink shows no join. */
  private rollOver(): void {
    const last = this.list[this.list.length - 1];
    this.completed.push(this.assemble(this.list));
    this.id = this.options.newId();
    this.origin = (this.origin ?? 0) + (last.time ?? 0);
    this.list = [{ ...last, time: 0 }];
    this.continued = true;
    this.added = 0;
  }

  private append(point: InkPoint): InkPoint | null {
    const key = quantized(point);
    if (sameKey(this.lastKey, key)) return null;
    this.lastKey = key;
    this.origin ??= point.time ?? 0;
    const placed = { ...point, time: (point.time ?? 0) - this.origin };
    this.list.push(placed);
    this.added++;
    if (this.list.length >= this.limit) this.rollOver();
    return placed;
  }
}

export function createStrokeBuilder(options: StrokeBuilderOptions): StrokeBuilder {
  return new Builder(options);
}
