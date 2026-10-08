// Positions: where a moment of the capture clock sits in the audio a person can play. The TypeScript twin of
// crates/media/src/positions.rs, and both pass the cases in crates/media/tests/fixtures/position-map.json.
//
// A recording's tracks cover stretches of capture time. A pause leaves a hole, and playback skips holes, so a
// position counts only the audio. The host sends the stretches when a recording opens, and every lookup after that
// happens here without a round trip.

import type { PositionMapData, Span } from './types';

/**
 * Where a capture time falls. `exact` is false when the time has no audio. The position is then where the next
 * audio starts.
 */
export interface Located {
  positionNs: number;
  exact: boolean;
}

/** The index of the first item that `before` is false for, in an array where it is true and then false. */
export function partitionPoint<T>(items: readonly T[], before: (item: T) => boolean): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (before(items[middle] as T)) low = middle + 1;
    else high = middle;
  }
  return low;
}

export class PositionMap {
  readonly spans: readonly Span[];

  constructor(spans: readonly Span[]) {
    this.spans = spans;
  }

  static fromData(data: PositionMapData): PositionMap {
    return new PositionMap(data.spans);
  }

  /** A map over capture-time ranges that are sorted and apart. */
  static fromRanges(ranges: readonly (readonly [number, number])[]): PositionMap {
    let position = 0;
    const spans = ranges.map(([captureStartNs, captureEndNs]) => {
      const span = { captureStartNs, captureEndNs, positionStartNs: position };
      position += captureEndNs - captureStartNs;
      return span;
    });
    return new PositionMap(spans);
  }

  /** The length of the playable audio. */
  get durationNs(): number {
    const last = this.spans[this.spans.length - 1];
    return last ? last.positionStartNs + (last.captureEndNs - last.captureStartNs) : 0;
  }

  /** The position of a capture time. */
  locate(captureNs: number): Located {
    const next = partitionPoint(this.spans, (span) => span.captureEndNs <= captureNs);
    const span = this.spans[next];
    if (span && span.captureStartNs <= captureNs) {
      return { positionNs: span.positionStartNs + (captureNs - span.captureStartNs), exact: true };
    }
    if (span) return { positionNs: span.positionStartNs, exact: false };
    return { positionNs: this.durationNs, exact: false };
  }

  /** The capture time at a position, or null past the end. */
  captureAt(positionNs: number): number | null {
    const index = partitionPoint(this.spans, (span) => span.positionStartNs <= positionNs) - 1;
    const span = this.spans[index];
    if (!span) return null;
    const offset = positionNs - span.positionStartNs;
    return offset < span.captureEndNs - span.captureStartNs ? span.captureStartNs + offset : null;
  }
}
