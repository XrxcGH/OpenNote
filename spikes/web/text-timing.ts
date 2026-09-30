// In-page typing measurements for the text spike.
//
// KeyTimer times each character key from the keydown event's timestamp. It records the editor's first document
// change, the start of the next frame, and the end of that frame's rendering on the main thread. The last one
// uses a message posted from requestAnimationFrame, which runs once style, layout, and paint are done.
//
// EventLog keeps the browser's own Event Timing entries. Their duration runs to the next frame's presentation,
// rounded to 8 ms, and only events of 16 ms or more are reported.

export interface KeyRecord {
  key: string;
  /** The keydown event's timestamp. Every other time is measured from it. */
  stamp: number;
  /** When the keydown handler started. */
  handler: number;
  /** When the editor applied its first transaction that changed the document. */
  update: number | null;
  /** The next frame's start time, from requestAnimationFrame. */
  frame: number | null;
  /** When the next frame's rendering finished on the main thread. */
  painted: number | null;
}

export class KeyTimer {
  records: KeyRecord[] = [];
  private current: KeyRecord | null = null;
  /** Called with each finished record, for the live panel. */
  onRecord: ((record: KeyRecord) => void) | null = null;

  constructor() {
    window.addEventListener('keydown', (event) => this.keyDown(event), { capture: true });
  }

  private keyDown(event: KeyboardEvent): void {
    if (event.key.length !== 1 || event.ctrlKey || event.altKey || event.metaKey) return;
    const record: KeyRecord = {
      key: event.key,
      stamp: event.timeStamp,
      handler: performance.now(),
      update: null,
      frame: null,
      painted: null,
    };
    this.records.push(record);
    if (this.records.length > 5000) this.records.shift();
    this.current = record;
    requestAnimationFrame((time) => {
      record.frame = time;
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        record.painted = performance.now();
        this.onRecord?.(record);
      };
      channel.port2.postMessage(null);
    });
  }

  /** Call from the editor's transaction event. */
  transaction(docChanged: boolean): void {
    if (docChanged && this.current && this.current.update === null) this.current.update = performance.now();
  }

  reset(): void {
    this.records = [];
    this.current = null;
  }
}

/** One Event Timing entry, with the optional paint and presentation times newer browsers add. */
export interface EventEntry {
  name: string;
  startTime: number;
  duration: number;
  processingStart: number;
  processingEnd: number;
  interactionId: number;
  paintTime?: number;
  presentationTime?: number;
}

const EXTRA_TIMES = ['paintTime', 'presentationTime'] as const;

function snapshot(entry: PerformanceEventTiming): EventEntry {
  const copy: EventEntry = {
    name: entry.name,
    startTime: entry.startTime,
    duration: entry.duration,
    processingStart: entry.processingStart,
    processingEnd: entry.processingEnd,
    interactionId: entry.interactionId ?? 0,
  };
  const raw = entry as unknown as Record<string, unknown>;
  for (const key of EXTRA_TIMES) if (typeof raw[key] === 'number') copy[key] = raw[key];
  return copy;
}

const WATCHED = new Set(['keydown', 'keypress', 'keyup', 'beforeinput', 'input']);

export class EventLog {
  entries: EventEntry[] = [];
  supported = true;

  constructor() {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        if (WATCHED.has(entry.name)) this.entries.push(snapshot(entry));
      }
      if (this.entries.length > 20000) this.entries.splice(0, this.entries.length - 20000);
    });
    try {
      observer.observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
    } catch {
      this.supported = false;
    }
  }

  reset(): void {
    this.entries = [];
  }
}

/** How many events of each watched type the browser has dispatched, including the fast ones. */
export function eventCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of WATCHED) counts[name] = performance.eventCounts?.get(name) ?? 0;
  return counts;
}
