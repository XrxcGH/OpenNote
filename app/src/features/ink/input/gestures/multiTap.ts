// Multi-finger double taps (architecture 12.4). With the pen away, a two-finger double tap undoes and a three-finger
// double tap redoes. A tap is a group of fingers that land together, lift quickly, and barely move. Two such groups
// of the same size, starting within 400 ms of each other, make the gesture. Call `cancel` when a pen comes near.

export interface MultiTapOptions {
  /** Fingers of one tap must all land within this long of the first. */
  readonly landMs: number;
  /** Every finger must lift within this long of landing. */
  readonly tapMs: number;
  /** A finger that moves farther than this many screen pixels makes the group no tap. */
  readonly moveLimit: number;
  /** The second tap must start within this long of the first one starting. */
  readonly doubleMs: number;
}

export const DEFAULT_MULTI_TAP: MultiTapOptions = { landMs: 150, tapMs: 250, moveLimit: 10, doubleMs: 400 };

export type MultiTapResult = 'undo' | 'redo' | null;

export interface MultiTapDetector {
  down(id: number, x: number, y: number, time: number): void;
  move(id: number, x: number, y: number): void;
  /** Returns the gesture when this lift completes the second tap. */
  up(id: number, time: number): MultiTapResult;
  /** Forgets everything, for when a pen comes near or a gesture takes the fingers. */
  cancel(): void;
}

interface Finger {
  readonly x: number;
  readonly y: number;
  readonly downTime: number;
  lifted: boolean;
}

interface Tap {
  readonly size: number;
  readonly start: number;
}

class Detector implements MultiTapDetector {
  private readonly options: MultiTapOptions;
  private readonly fingers = new Map<number, Finger>();
  private groupStart = 0;
  private valid = true;
  private previous: Tap | null = null;

  constructor(options: Partial<MultiTapOptions>) {
    this.options = { ...DEFAULT_MULTI_TAP, ...options };
  }

  down(id: number, x: number, y: number, time: number): void {
    if (this.fingers.size === 0) {
      this.groupStart = time;
      this.valid = true;
    } else if (time - this.groupStart > this.options.landMs) {
      this.valid = false;
    }
    this.fingers.set(id, { x, y, downTime: time, lifted: false });
  }

  move(id: number, x: number, y: number): void {
    const finger = this.fingers.get(id);
    if (finger && Math.hypot(x - finger.x, y - finger.y) > this.options.moveLimit) this.valid = false;
  }

  up(id: number, time: number): MultiTapResult {
    const finger = this.fingers.get(id);
    if (!finger) return null;
    finger.lifted = true;
    if (time - finger.downTime > this.options.tapMs) this.valid = false;
    if ([...this.fingers.values()].some((f) => !f.lifted)) return null;
    const size = this.fingers.size;
    const wasValid = this.valid;
    this.reset();
    if (!wasValid) {
      this.previous = null;
      return null;
    }
    return size === 2 || size === 3 ? this.complete(size) : null;
  }

  cancel(): void {
    this.reset();
    this.previous = null;
  }

  private reset(): void {
    this.fingers.clear();
    this.valid = true;
  }

  private complete(size: number): MultiTapResult {
    const tap: Tap = { size, start: this.groupStart };
    const prior = this.previous;
    const isDouble = prior !== null && prior.size === size && tap.start - prior.start <= this.options.doubleMs;
    this.previous = isDouble ? null : tap;
    if (!isDouble) return null;
    return size === 2 ? 'undo' : 'redo';
  }
}

export function createMultiTapDetector(options: Partial<MultiTapOptions> = {}): MultiTapDetector {
  return new Detector(options);
}
