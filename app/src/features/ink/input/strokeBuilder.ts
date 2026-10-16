// The stroke builder: raw samples in, a finished stroke out (architecture 6.2, 6.6, and 6.8). It applies the pen's
// pressure curve and the steady pen. It drops samples a record could not tell apart. At the point limit it ends the
// stroke and continues in a new one from the same point. It depends only on the samples, so a recording replays to
// the same stroke, which the steady pen needs (architecture 5.8). A pen sample allocates only the point it stores.
//
// Zero pressure is decided per stroke. Once any sample has pressure, a 0 is a real reading: a leading 0 takes the
// first pressure that follows, and a later 0 (such as the lift) repeats the previous one. A stroke that never reports
// pressure keeps the middle pressure, which is what Pointer Events give a pen without a sensor.

import { MAX_POINTS } from '../../../core/ink/codec';
import { createStabilizer } from '../geometry/stabilizer';
import type { Stabilizer, StabilizerOptions } from '../geometry/stabilizer';
import type { InkPoint, InkTool } from '../geometry/types';
import { POSITION_STEPS_PER_UNIT, PRESSURE_MAX, TILT_STEPS_PER_DEGREE } from '../model/types';
import type { InkStroke } from '../model/types';
import type { Rgba } from '../pens/palette';
import { newScratch, normalizeInto } from './samples';
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
  /**
   * Unix milliseconds at time 0 of the sample clock, taken fresh for each stroke at pen contact as
   * `Date.now() - performance.now()`. `performance.timeOrigin` drifts on systems whose monotonic clock stops in sleep.
   */
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

/** True when some point leans: a tilt of zero on every point means the device reports none that is real. */
function hasTilt(points: readonly InkPoint[]): boolean {
  return points.some((p) => (p.tiltX ?? 0) !== 0 || (p.tiltY ?? 0) !== 0);
}

function withoutTilt(point: InkPoint): InkPoint {
  const { tiltX: _x, tiltY: _y, ...rest } = point;
  return rest;
}

type Mutable = { -readonly [K in keyof InkPoint]: InkPoint[K] };

class Builder implements StrokeBuilder {
  private readonly limit: number;
  private readonly stabilizer: Stabilizer | null;
  private readonly completed: InkStroke[] = [];
  private readonly scratch = newScratch();
  private readonly steadied = { x: 0, y: 0 };
  /** The raw last sample, so the steady pen catches up to the lift. */
  private readonly raw = newScratch();
  private hasRaw = false;
  private id: string;
  private origin: number | null = null;
  private list: InkPoint[] = [];
  /** The last stored point's quantized form, in five fields. */
  private kx = Number.NaN;
  private ky = 0;
  private kp = 0;
  private ktx = 0;
  private kty = 0;
  private continued = false;
  private added = 0;
  /** Pressure seen in this stroke, the last stored pressure, and leading points stored before any. */
  private pressureSeen = false;
  private lastPressure = 0;
  private leading = 0;

  constructor(private readonly options: StrokeBuilderOptions) {
    this.limit = options.maxPoints ?? MAX_POINTS;
    this.stabilizer = options.steady ? createStabilizer(options.steady) : null;
    this.id = options.newId();
  }

  get points(): readonly InkPoint[] {
    return this.list;
  }

  push(sample: RawSample): InkPoint | null {
    const s = this.scratch;
    if (!normalizeInto(sample, s, this.options.pressureTable)) return null;
    this.resolveZero(s.zero);
    Object.assign(this.raw, s);
    this.hasRaw = true;
    if (this.stabilizer) {
      this.stabilizer.steady(s.x, s.y, s.time, this.steadied);
      s.x = this.steadied.x;
      s.y = this.steadied.y;
    }
    return this.append(s);
  }

  snapshot(): InkStroke | null {
    return this.list.length > 0 ? this.assemble(this.list) : null;
  }

  takeCompleted(): InkStroke[] {
    return this.completed.splice(0, this.completed.length);
  }

  finish(): InkStroke[] {
    if (this.stabilizer && this.hasRaw) this.append(this.raw);
    const out = this.takeCompleted();
    if (this.list.length > 0 && (!this.continued || this.added > 0)) out.push(this.assemble(this.list));
    return out;
  }

  /** Settles a 0 from a pen with pressure (see the file comment), and back-fills leading zeros once pressure shows. */
  private resolveZero(zero: boolean): void {
    const s = this.scratch;
    if (s.pressure < 0) return;
    if (zero) {
      if (this.pressureSeen) s.pressure = this.lastPressure;
      return;
    }
    if (!this.pressureSeen) {
      this.pressureSeen = true;
      this.backFill(s.pressure);
    }
    this.lastPressure = s.pressure;
  }

  private backFill(pressure: number): void {
    const from = Math.max(0, this.list.length - this.leading);
    for (let k = from; k < this.list.length; k++) this.list[k] = { ...this.list[k], pressure };
    this.leading = 0;
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
    this.leading = 0;
  }

  private append(s: ReturnType<typeof newScratch>): InkPoint | null {
    const qx = Math.round(s.x * POSITION_STEPS_PER_UNIT);
    const qy = Math.round(s.y * POSITION_STEPS_PER_UNIT);
    const qp = Math.round(Math.max(0, s.pressure) * PRESSURE_MAX);
    const qtx = s.hasTilt ? Math.round(s.tiltX * TILT_STEPS_PER_DEGREE) : 0;
    const qty = s.hasTilt ? Math.round(s.tiltY * TILT_STEPS_PER_DEGREE) : 0;
    if (qx === this.kx && qy === this.ky && qp === this.kp && qtx === this.ktx && qty === this.kty) return null;
    this.kx = qx;
    this.ky = qy;
    this.kp = qp;
    this.ktx = qtx;
    this.kty = qty;
    this.origin ??= s.time;
    const placed: Mutable = { x: s.x, y: s.y, time: s.time - this.origin };
    if (s.pressure >= 0) {
      placed.pressure = s.pressure;
      if (s.hasTilt) {
        placed.tiltX = s.tiltX;
        placed.tiltY = s.tiltY;
      }
      if (!this.pressureSeen) this.leading++;
    }
    this.list.push(placed);
    this.added++;
    if (this.list.length >= this.limit) this.rollOver();
    return placed;
  }
}

export function createStrokeBuilder(options: StrokeBuilderOptions): StrokeBuilder {
  return new Builder(options);
}
