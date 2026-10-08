// Multi-finger double taps (architecture 12.4). With the pen away, a two-finger double tap undoes and a three-finger
// double tap redoes. A tap is a group of fingers that land together at finger spacing, lift quickly, and barely move.
// Two such groups of the same size, starting within 400 ms of each other, make the gesture. The result waits a short
// confirm window and is delivered by `poll`, so a pen event (`cancel`) or a palm verdict (`voidContact`) that arrives
// first can still stop it. Positions and sizes are millimeters.

export interface MultiTapOptions {
  /** Fingers of one tap must all land within this long of the first. */
  readonly landMs: number;
  /** Every finger must lift within this long of landing. A group with a finger still down after this is void. */
  readonly tapMs: number;
  /** A finger that moves farther than this many mm makes the group no tap. */
  readonly moveLimit: number;
  /** The second tap must start within this long of the first one starting. */
  readonly doubleMs: number;
  /** The result waits this long for a pen event or a palm verdict before it is delivered. */
  readonly confirmMs: number;
  /** A contact this long in mm is a palm, which voids the group. */
  readonly palmMm: number;
  /** Fingers of one tap sit this far apart, in mm. */
  readonly minSpacing: number;
  readonly maxSpacing: number;
}

export const DEFAULT_MULTI_TAP: MultiTapOptions = {
  landMs: 150,
  tapMs: 250,
  moveLimit: 2,
  doubleMs: 400,
  confirmMs: 150,
  palmMm: 20,
  minSpacing: 15,
  maxSpacing: 80,
};

export type MultiTapResult = 'undo' | 'redo' | null;

export interface MultiTapDetector {
  /** A finger lands. Width and height in mm, 0 when the digitizer reports none. */
  down(id: number, x: number, y: number, w: number, h: number, time: number): void;
  move(id: number, x: number, y: number): void;
  /** A finger lifts, or the OS cancels it, which voids the gesture. */
  up(id: number, time: number, canceled: boolean): void;
  /** Delivers a gesture whose confirm window has passed, and voids a group whose fingers stayed down too long. */
  poll(time: number): MultiTapResult;
  /** A palm verdict for a contact: a gesture it belongs to is void. */
  voidContact(id: number): void;
  /** Forgets everything, for when a pen comes near or a gesture takes the fingers. */
  cancel(): void;
  /** Raises the spacing fingers of one tap need, in mm, for the fingers that land next; 0 restores the default. */
  setMinSpacing(mm: number): void;
}

interface Finger {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly downTime: number;
  lifted: boolean;
}

interface Tap {
  readonly size: number;
  readonly start: number;
  readonly ids: readonly number[];
}

class Detector implements MultiTapDetector {
  private readonly options: MultiTapOptions;
  private fingers: Finger[] = [];
  private groupStart = 0;
  private valid = true;
  private previous: Tap | null = null;
  private pending: { result: MultiTapResult; at: number; ids: readonly number[] } | null = null;
  private minSpacing = 0;

  constructor(options: Partial<MultiTapOptions>) {
    this.options = { ...DEFAULT_MULTI_TAP, ...options };
  }

  down(id: number, x: number, y: number, w: number, h: number, time: number): void {
    this.expire(time);
    const o = this.options;
    if (this.fingers.length === 0) {
      this.groupStart = time;
      this.valid = true;
    } else if (time - this.groupStart > o.landMs) {
      this.valid = false;
    }
    if (Math.max(w, h) >= o.palmMm) this.valid = false;
    for (const f of this.fingers) {
      const d = Math.hypot(x - f.x, y - f.y);
      if (d < Math.max(o.minSpacing, this.minSpacing) || d > o.maxSpacing) this.valid = false;
    }
    this.fingers.push({ id, x, y, downTime: time, lifted: false });
  }

  move(id: number, x: number, y: number): void {
    const finger = this.fingers.find((f) => f.id === id);
    if (finger && Math.hypot(x - finger.x, y - finger.y) > this.options.moveLimit) this.valid = false;
  }

  up(id: number, time: number, canceled: boolean): void {
    const finger = this.fingers.find((f) => f.id === id);
    if (!finger) return;
    finger.lifted = true;
    if (canceled) {
      this.valid = false;
      this.previous = null;
      this.pending = null;
    }
    if (time - finger.downTime > this.options.tapMs) this.valid = false;
    if (this.fingers.some((f) => !f.lifted)) return;
    const size = this.fingers.length;
    const ids = this.fingers.map((f) => f.id);
    const wasValid = this.valid;
    this.reset();
    if (!wasValid) {
      this.previous = null;
      return;
    }
    if (size === 2 || size === 3) this.complete(size, ids, time);
  }

  poll(time: number): MultiTapResult {
    this.expire(time);
    const pending = this.pending;
    if (!pending || time < pending.at) return null;
    this.pending = null;
    return pending.result;
  }

  voidContact(id: number): void {
    if (this.fingers.some((f) => f.id === id)) this.valid = false;
    if (this.previous?.ids.includes(id)) this.previous = null;
    if (this.pending?.ids.includes(id)) this.pending = null;
  }

  cancel(): void {
    this.reset();
    this.previous = null;
    this.pending = null;
  }

  setMinSpacing(mm: number): void {
    this.minSpacing = mm;
  }

  /** A group with a finger still down after `tapMs` is no tap; its lift may never come. */
  private expire(time: number): void {
    if (this.fingers.length === 0) return;
    const stuck = this.fingers.some((f) => !f.lifted && time - f.downTime > this.options.tapMs);
    if (!stuck) return;
    this.reset();
    this.previous = null;
  }

  private reset(): void {
    this.fingers = [];
    this.valid = true;
  }

  private complete(size: number, ids: readonly number[], time: number): void {
    const tap: Tap = { size, start: this.groupStart, ids };
    const prior = this.previous;
    const isDouble = prior !== null && prior.size === size && tap.start - prior.start <= this.options.doubleMs;
    this.previous = isDouble ? null : tap;
    if (!isDouble) return;
    this.pending = {
      result: size === 2 ? 'undo' : 'redo',
      at: time + this.options.confirmMs,
      ids: [...prior.ids, ...ids],
    };
  }
}

export function createMultiTapDetector(options: Partial<MultiTapOptions> = {}): MultiTapDetector {
  return new Detector(options);
}
