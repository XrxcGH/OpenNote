// Held touch strokes and recent commits. A touch stroke that lifts on a device that has seen a pen waits for
// `graceMs`; real pen evidence at or after its start, up to the end of the hold, drops it. A stroke committed
// shortly before a pen arrives, inside the new pen's hand region, is taken back.

import { MAX_COMMITS, MAX_HOLDS } from './thresholds';

export class Holds {
  readonly id = new Int32Array(MAX_HOLDS);
  readonly start = new Float64Array(MAX_HOLDS);
  readonly until = new Float64Array(MAX_HOLDS);
  readonly x = new Float64Array(MAX_HOLDS);
  readonly y = new Float64Array(MAX_HOLDS);
  readonly used = new Uint8Array(MAX_HOLDS);
  count = 0;

  /** Returns the slot, or -1 when 8 strokes are already held. */
  add(id: number, start: number, until: number, x: number, y: number): number {
    for (let h = 0; h < MAX_HOLDS; h++) {
      if (this.used[h] === 1) continue;
      this.used[h] = 1;
      this.count++;
      this.id[h] = id;
      this.start[h] = start;
      this.until[h] = until;
      this.x[h] = x;
      this.y[h] = y;
      return h;
    }
    return -1;
  }

  remove(h: number): void {
    if (this.used[h] === 0) return;
    this.used[h] = 0;
    this.count--;
  }
}

export class RecentCommits {
  readonly id = new Int32Array(MAX_COMMITS);
  readonly t = new Float64Array(MAX_COMMITS).fill(-Infinity);
  readonly x = new Float64Array(MAX_COMMITS);
  readonly y = new Float64Array(MAX_COMMITS);
  private next = 0;

  add(id: number, t: number, x: number, y: number): void {
    const k = this.next;
    this.id[k] = id;
    this.t[k] = t;
    this.x[k] = x;
    this.y[k] = y;
    this.next = (k + 1) % MAX_COMMITS;
  }

  forget(k: number): void {
    this.t[k] = -Infinity;
  }
}
