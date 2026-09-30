// Timing records for the ink spike. All times are performance.now() milliseconds.

/**
 * One pointer event. The harness reads these to split its screen latency into input, drawing, and
 * presentation. Short keys keep the records small when the harness fetches thousands of them.
 */
export interface EventRecord {
  /** 'd' for pen down, 'm' for a move that drew ink. */
  k: 'd' | 'm';
  /** event.timeStamp: when the browser says the input happened. */
  t: number;
  /** When the handler started. */
  s: number;
  /** When the handler ended. */
  e: number;
  /** When this event's ink was drawn: the handler's end, or the end of the frame callback that drew it. */
  d: number;
  /** When the next animation frame callback started, or 0 if it hasn't run yet. */
  f: number;
  x: number;
  y: number;
  /** Coalesced events delivered with this one. */
  n: number;
  /** Predicted events available with this one. */
  p: number;
}

/** Summary of a list of durations. */
export interface Summary {
  count: number;
  p50: number;
  p95: number;
}

/** At most this many records are kept, which covers a full automated run of one mode. */
const MAX_RECORDS = 50_000;

/** Keeps event records and fills in when the next frame began after each one. */
export class EventLog {
  readonly records: EventRecord[] = [];
  private waiting: EventRecord[] = [];
  private frameRequested = false;

  add(record: EventRecord): void {
    if (this.records.length >= MAX_RECORDS) this.records.shift();
    this.records.push(record);
    this.waiting.push(record);
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      const now = performance.now();
      for (const waiting of this.waiting) waiting.f = now;
      this.waiting = [];
      this.frameRequested = false;
    });
  }

  /** Sets the drawn time of records whose ink was drawn later, in a frame callback. */
  markDrawn(records: readonly EventRecord[], time: number): void {
    for (const record of records) record.d = time;
  }
}

/** The p-th percentile (0 to 100) of sorted values, interpolating between ranks. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/** Median and 95th percentile of the values. */
export function summarize(values: readonly number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
}

/** Records animation frame times while running, to show frame pacing during a stroke. */
export class FramePacer {
  private times: number[] = [];
  private running = false;

  start(): void {
    this.times = [];
    this.running = true;
    const tick = (time: number) => {
      if (!this.running) return;
      this.times.push(time);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Stops recording and returns the intervals between frames in milliseconds. */
  stop(): number[] {
    this.running = false;
    return intervals(this.times);
  }
}

/** Waits for `count` frames and returns the intervals between them. */
export async function frameIntervals(count: number): Promise<number[]> {
  const times: number[] = [];
  while (times.length <= count) {
    times.push(await new Promise<number>((resolve) => requestAnimationFrame(resolve)));
  }
  return intervals(times);
}

function intervals(times: readonly number[]): number[] {
  return times.slice(1).map((time, index) => time - times[index]);
}
