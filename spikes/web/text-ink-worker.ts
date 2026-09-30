// A worker that draws ink tiles for the "tiles" ink mode, off the main thread. It draws on software canvases, so
// the work never queues in the GPU process ahead of the compositor's frames. Each tile goes back as an
// ImageBitmap that the page shows without copying.
import { makeStrokes, overlaps } from './text-strokes';

/** A rectangle of the world to draw, in world pixels, at `scale` device pixels per world pixel. */
export interface TileJob {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export type ToWorker =
  { type: 'init'; count: number; background: string } | { type: 'jobs'; jobs: TileJob[]; seq: number };

export type FromWorker =
  | { type: 'ready'; ms: number }
  | { type: 'tile'; job: TileJob; bitmap: ImageBitmap | null; ms: number }
  | { type: 'idle'; seq: number };

let strokes: ReturnType<typeof makeStrokes> = [];
let paths: Path2D[] = [];
let queue: TileJob[] = [];
let busy = false;
/** The number of the job list being worked on, reported when it's done. */
let seq = 0;
/** The page color. Ink is the lowest layer, so tiles can be opaque. */
let background = '#fff';

function post(message: FromWorker, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

/** Draws one job on the page color, so a tile hides the blurry overview under it. A tile no stroke touches is a
 * single pixel of page color, stretched. */
function draw(job: TileJob): ImageBitmap | null {
  const { x, y, width, height, scale } = job;
  const hits = strokes.flatMap((stroke, index) => (overlaps(stroke, x, y, x + width, y + height) ? [index] : []));
  const size = hits.length === 0 ? [1, 1] : [Math.ceil(width * scale), Math.ceil(height * scale)];
  const canvas = new OffscreenCanvas(size[0], size[1]);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.fillStyle = background;
  context.fillRect(0, 0, size[0], size[1]);
  context.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
  for (const index of hits) {
    context.fillStyle = strokes[index].color;
    context.fill(paths[index]);
  }
  return canvas.transferToImageBitmap();
}

/** Draws queued jobs one at a time, yielding between them so a newer job list can replace the queue. */
function step(): void {
  const job = queue.shift();
  if (!job) {
    busy = false;
    post({ type: 'idle', seq });
    return;
  }
  const started = performance.now();
  const bitmap = draw(job);
  post({ type: 'tile', job, bitmap, ms: performance.now() - started }, bitmap ? [bitmap] : []);
  setTimeout(step, 0);
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === 'init') {
    const started = performance.now();
    strokes = makeStrokes(message.count);
    paths = strokes.map((stroke) => new Path2D(stroke.path));
    background = message.background;
    post({ type: 'ready', ms: performance.now() - started });
    return;
  }
  queue = message.jobs;
  seq = message.seq;
  if (!busy) {
    busy = true;
    setTimeout(step, 0);
  }
};
