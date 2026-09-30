// Pointer input for the ink spike: how each renderer mode turns pen events into ink.
import type { Renderer } from './ink-canvas';
import type { EventLog, EventRecord } from './ink-metrics';
import { INK_COLOR, INK_SIZE, type InkPoint } from './ink-stroke';

export const MODES = [
  'canvas2d',
  'canvas2d-raf',
  'desync',
  'raw',
  'webgl-desync',
  'delegated',
  'trail-only',
  'predicted',
  'desync-busy',
  'delegated-busy',
] as const;
export type Mode = (typeof MODES)[number];

/** How a mode draws. */
export interface ModeSpec {
  mode: Mode;
  /** Ask for a desynchronized (low-latency) context. */
  desync: boolean;
  webgl: boolean;
  /**
   * Draw in the pointermove handler, in the next animation frame, or in pointerrawupdate. With
   * 'none' the page draws nothing, so only a delegated ink trail can show the stroke.
   */
  draw: 'handler' | 'frame' | 'raw' | 'none';
  /** Draw a temporary tail through the browser's predicted points. */
  predict: boolean;
  /** Let the compositor draw a delegated ink trail ahead of the page. */
  delegate: boolean;
  /** Keep the main thread busy with long tasks, as a large app might. */
  busy: boolean;
}

const DESYNC: Omit<ModeSpec, 'mode'> = {
  desync: true,
  webgl: false,
  draw: 'handler',
  predict: false,
  delegate: false,
  busy: false,
};

const SPECS: Record<Mode, Omit<ModeSpec, 'mode'>> = {
  canvas2d: { ...DESYNC, desync: false },
  'canvas2d-raf': { ...DESYNC, desync: false, draw: 'frame' },
  desync: DESYNC,
  raw: { ...DESYNC, draw: 'raw' },
  'webgl-desync': { ...DESYNC, webgl: true },
  delegated: { ...DESYNC, delegate: true },
  // A plain canvas, because it sends the compositor frames that carry the trail's start point.
  'trail-only': { ...DESYNC, desync: false, delegate: true, draw: 'none' },
  predicted: { ...DESYNC, predict: true },
  'desync-busy': { ...DESYNC, busy: true },
  'delegated-busy': { ...DESYNC, delegate: true, busy: true },
};

/** The spec for a mode name, falling back to desync for unknown names. */
export function modeSpec(name: string | null): ModeSpec {
  const mode = MODES.find((candidate) => candidate === name) ?? 'desync';
  return { mode, ...SPECS[mode] };
}

// Delegated Ink Trails (https://wicg.github.io/ink-enhancement/), which TypeScript's DOM types lack.
export interface InkTrailStyle {
  color: string;
  diameter: number;
}
export interface InkPresenter {
  updateInkTrailStartPoint(event: PointerEvent, style: InkTrailStyle): void;
}
interface Ink {
  requestPresenter(options?: { presentationArea?: Element }): Promise<InkPresenter>;
}

/** Asks the browser for a delegated ink trail presenter over the canvas, or null if it has none. */
export async function requestPresenter(canvas: HTMLCanvasElement): Promise<InkPresenter | null> {
  const ink = (navigator as Navigator & { ink?: Ink }).ink;
  if (!ink) return null;
  try {
    return await ink.requestPresenter({ presentationArea: canvas });
  } catch {
    return null;
  }
}

/** The last pen sample, so the harness can check that pressure and tilt arrive. */
export interface PenState {
  pointerType: string;
  pressure: number;
  tiltX: number;
  tiltY: number;
}

interface Pipeline {
  spec: ModeSpec;
  renderer: Renderer;
  log: EventLog;
  presenter: InkPresenter | null;
}

const TRAIL: InkTrailStyle = { color: INK_COLOR, diameter: INK_SIZE };

function toPoint(event: PointerEvent): InkPoint {
  const pressure = event.pointerType === 'mouse' || event.pressure === 0 ? 0.5 : event.pressure;
  return { x: event.clientX, y: event.clientY, pressure };
}

function coalesced(event: PointerEvent): InkPoint[] {
  const events = event.getCoalescedEvents?.() ?? [];
  return (events.length > 0 ? events : [event]).map(toPoint);
}

function predicted(event: PointerEvent): InkPoint[] {
  return (event.getPredictedEvents?.() ?? []).map(toPoint);
}

function record(kind: EventRecord['k'], event: PointerEvent, start: number, counts: [number, number]): EventRecord {
  const end = performance.now();
  const [n, p] = counts;
  return { k: kind, t: event.timeStamp, s: start, e: end, d: end, f: 0, x: event.clientX, y: event.clientY, n, p };
}

/** Turns pointer events on the canvas into ink, the way the mode's spec says. */
class InkInput {
  /** The pointer drawing the current stroke. */
  private active: number | null = null;
  pen: PenState | null = null;
  private readonly queue: ReturnType<typeof frameQueue>;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly pipeline: Pipeline,
  ) {
    this.queue = frameQueue(pipeline.renderer, pipeline.log);
  }

  readonly down = (event: PointerEvent) => {
    const start = performance.now();
    if (this.active !== null) return;
    this.active = event.pointerId;
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Some synthetic pointers can't be captured; drawing works without capture.
    }
    if (this.pipeline.spec.draw !== 'none') this.pipeline.renderer.start(toPoint(event));
    this.trail(event);
    this.pipeline.log.add(record('d', event, start, [1, 0]));
  };

  readonly move = (event: PointerEvent) => {
    const start = performance.now();
    if (event.pointerId !== this.active) return;
    const { spec, renderer, log } = this.pipeline;
    const { pointerType, pressure, tiltX, tiltY } = event;
    this.pen = { pointerType, pressure, tiltX, tiltY };
    const points = coalesced(event);
    // Every mode counts the predicted points, to show when the browser offers them.
    const guesses = predicted(event);
    const counts: [number, number] = [points.length, guesses.length];
    if (spec.draw === 'frame') return this.queue(points, record('m', event, start, counts));
    if (spec.draw !== 'none') renderer.extend(points);
    if (spec.predict) renderer.preview(guesses);
    this.trail(event);
    log.add(record('m', event, start, counts));
  };

  readonly up = (event: PointerEvent) => {
    if (event.pointerId !== this.active) return;
    this.active = null;
    this.pipeline.renderer.settle();
  };

  private trail(event: PointerEvent): void {
    try {
      this.pipeline.presenter?.updateInkTrailStartPoint(event, TRAIL);
    } catch {
      // The browser refuses some events, such as untrusted ones; the page's own ink still draws.
    }
  }
}

/** Listens for pen, touch, and mouse input on the canvas and draws it. Returns the last pen state. */
export function attachInput(canvas: HTMLCanvasElement, pipeline: Pipeline): () => PenState | null {
  const input = new InkInput(canvas, pipeline);
  const moveEvent = pipeline.spec.draw === 'raw' ? 'pointerrawupdate' : 'pointermove';
  canvas.addEventListener('pointerdown', input.down);
  canvas.addEventListener(moveEvent, input.move as EventListener);
  canvas.addEventListener('pointerup', input.up);
  canvas.addEventListener('pointercancel', input.up);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  return () => input.pen;
}

/** Queues points and draws them together in the next animation frame, as many web apps do. */
function frameQueue(renderer: Renderer, log: EventLog) {
  let points: InkPoint[] = [];
  let records: EventRecord[] = [];
  const draw = () => {
    renderer.extend(points);
    log.markDrawn(records, performance.now());
    points = [];
    records = [];
  };
  return (added: InkPoint[], entry: EventRecord) => {
    if (records.length === 0) requestAnimationFrame(draw);
    points.push(...added);
    entry.d = 0;
    records.push(entry);
    log.add(entry);
  };
}
