// Stamps text on the capture clock. Strokes carry Unix times, which the recording's clock anchor converts. Text has
// no time of its own, so each edit needs a capture time. The interface's clock (performance.now) is not the capture
// clock, which is the Windows performance counter that the host reads. This clock learns the offset between them.
//
// Each reading from the host is taken between two local readings. The host's clock value was read somewhere in that
// round trip, so the offset is uncertain by up to half of it. The best of the recent readings is the one with the
// shortest round trip. The status calls that already poll the host give a new reading every few hundred
// milliseconds, so the offset follows the small drift between the two clocks without extra calls.

import type { ClockReading } from './types';

const NS_PER_MS = 1_000_000;
/** How many readings the clock keeps to choose from. */
const WINDOW = 40;

interface Reading {
  /** Host capture time minus local time, in nanoseconds. */
  offsetNs: number;
  /** The round trip of the call, in milliseconds. */
  roundTripMs: number;
}

export class HostClock {
  private readonly readings: Reading[] = [];
  private readonly localNow: () => number;

  /** `localNow` is the interface's clock in milliseconds, which is `performance.now` unless a test replaces it. */
  constructor(localNow: () => number = () => performance.now()) {
    this.localNow = localNow;
  }

  /** Takes in a reading of the host clock that was requested at `sentMs` and answered at `receivedMs`, local time. */
  observe(host: ClockReading, sentMs: number, receivedMs: number): void {
    const roundTripMs = Math.max(receivedMs - sentMs, 0);
    const middleMs = (sentMs + receivedMs) / 2;
    this.readings.push({ offsetNs: host.captureNs - middleMs * NS_PER_MS, roundTripMs });
    if (this.readings.length > WINDOW) this.readings.shift();
  }

  /** Reads the host clock a few times, and keeps the readings. Call it before the first stamp. */
  async calibrate(read: () => Promise<ClockReading>, times = 5): Promise<void> {
    for (let attempt = 0; attempt < times; attempt += 1) {
      const sentMs = this.localNow();
      const host = await read();
      this.observe(host, sentMs, this.localNow());
    }
  }

  get isCalibrated(): boolean {
    return this.readings.length > 0;
  }

  private best(): Reading | undefined {
    return this.readings.reduce<Reading | undefined>(
      (best, reading) => (!best || reading.roundTripMs < best.roundTripMs ? reading : best),
      undefined,
    );
  }

  /** How far off the clock can be, in milliseconds: half of the best round trip. */
  get uncertaintyMs(): number {
    return (this.best()?.roundTripMs ?? Infinity) / 2;
  }

  /** The capture time now, in nanoseconds. It throws before the first reading. */
  nowNs(): number {
    const best = this.best();
    if (!best) throw new Error('The host clock has not been read yet.');
    return Math.round(this.localNow() * NS_PER_MS + best.offsetNs);
  }
}
