// Telling a tap of a pen or a finger from a press that places the caret or starts a drag (Phase 9, "Tap a word to
// hear it"). A tap is a quick press that barely moves. A mouse never taps here: it has Alt+click. A pen or a finger
// that taps while a recording is open for listening plays from the word; otherwise it takes two quick taps, so a
// single tap still just places the caret to type.

export interface PointerSample {
  id: number;
  /** 'pen', 'touch', or 'mouse'. */
  type: string;
  x: number;
  y: number;
  /** Milliseconds on any steady clock. */
  at: number;
}

export type TapKind = 'tap' | 'double';

export interface TapLimits {
  /** The most a press may last to count as a tap. */
  maxMs: number;
  /** The most the pointer may move, in CSS pixels, between press and release. */
  maxMove: number;
  /** The longest gap between the taps of a double tap. */
  doubleMs: number;
  /** The most the second tap may be from the first. */
  doubleMove: number;
}

export const TAP_LIMITS: TapLimits = { maxMs: 450, maxMove: 10, doubleMs: 400, doubleMove: 32 };

export class TapRecognizer {
  private down: PointerSample | null = null;
  private last: PointerSample | null = null;

  constructor(private readonly limits: TapLimits = TAP_LIMITS) {}

  press(sample: PointerSample): void {
    // A second finger turns a tap into a pinch or a scroll.
    this.down = sample.type === 'mouse' || (this.down && this.down.id !== sample.id) ? null : sample;
  }

  /** The press ended. Answers what it was, or null when it was not a tap. */
  release(sample: PointerSample): TapKind | null {
    const down = this.down;
    this.down = null;
    if (!down || down.id !== sample.id || sample.type === 'mouse') return null;
    const { maxMs, maxMove, doubleMs, doubleMove } = this.limits;
    if (sample.at - down.at > maxMs || Math.hypot(sample.x - down.x, sample.y - down.y) > maxMove) {
      this.last = null;
      return null;
    }
    const before = this.last;
    if (before && sample.at - before.at <= doubleMs && Math.hypot(sample.x - before.x, sample.y - before.y) <= doubleMove) {
      this.last = null;
      return 'double';
    }
    this.last = sample;
    return 'tap';
  }

  /** The press was taken over by a scroll or a drag. */
  cancel(): void {
    this.down = null;
    this.last = null;
  }
}

/** Whether a tap of this kind plays from the word: a single tap while listening, and a double tap at any time. */
export const tapPlays = (kind: TapKind, listening: boolean): boolean => kind === 'double' || listening;
