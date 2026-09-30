// The "tiles" ink mode: a worker draws the ink into tiles once, and the tiles then move and scale with the world
// like images. Each tile covers 256 world pixels at a resolution that follows the zoom in powers of two. So
// zooming only redraws a tile when the zoom passes a power of two, and never on the main thread.
//
// A blurry overview of all the ink sits underneath, so a tile that isn't ready yet never shows a gap. Ink is the
// lowest layer, so tiles are opaque, painted on the page color, and hide the overview once they arrive.
import type { FromWorker, TileJob, ToWorker } from './text-ink-worker';
import type { Camera } from './text-world';

const TILE = 256;
/** Tiles to draw beyond the window's edges, and the wider band kept before a tile is dropped. */
const DRAW_MARGIN = 1;
const KEEP_MARGIN = 3;
const OVERVIEW_LEVEL = 1 / 8;

/** The tile resolution for a zoom: the next power of two up, from 1/4 to 2 device pixels per CSS pixel. */
export function levelFor(scale: number): number {
  return Math.min(2, Math.max(1 / 4, 2 ** Math.ceil(Math.log2(scale))));
}

interface Tile {
  canvas: HTMLCanvasElement | null;
  scale: number;
}

function placeCanvas(className: string, x: number, y: number, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = className;
  Object.assign(canvas.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  return canvas;
}

export class TileInk {
  private readonly worker: Worker;
  private readonly container: HTMLDivElement;
  private readonly tiles = new Map<string, Tile>();
  private keep = new Set<string>();
  private overviewDone = false;
  private signature = '';
  private sent = 0;
  private finished = 0;
  private waiters: (() => void)[] = [];
  /** Milliseconds each tile took to draw in the worker, since the last `takeRenderMs()`. */
  private renderMs: number[] = [];

  constructor(
    world: HTMLElement,
    count: number,
    private readonly extent: [number, number],
  ) {
    this.container = document.createElement('div');
    this.container.className = 'ink-tiles';
    world.prepend(this.container);
    this.worker = new Worker(new URL('./text-ink-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => this.receive(event.data);
    const background = getComputedStyle(document.documentElement).getPropertyValue('--page').trim() || '#fff';
    this.post({ type: 'init', count, background });
  }

  private post(message: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }

  /** Asks the worker for every tile in view that isn't drawn at the zoom's resolution, nearest the center first. */
  update(camera: Camera, width: number, height: number): void {
    const scale = levelFor(camera.scale) * window.devicePixelRatio;
    const view = [-camera.x, -camera.y, width - camera.x, height - camera.y].map((edge) => edge / camera.scale);
    const [centerX, centerY] = [(view[0] + view[2]) / 2, (view[1] + view[3]) / 2];
    const jobs: TileJob[] = [];
    this.keep = new Set();
    this.forTiles(view, KEEP_MARGIN, (key) => this.keep.add(key));
    this.forTiles(view, DRAW_MARGIN, (key, x, y) => {
      if (this.tiles.get(key)?.scale !== scale) jobs.push({ key, x, y, width: TILE, height: TILE, scale });
    });
    const distance = (job: TileJob) => Math.hypot(job.x + TILE / 2 - centerX, job.y + TILE / 2 - centerY);
    jobs.sort((a, b) => distance(a) - distance(b));
    if (!this.overviewDone) {
      const [right, bottom] = this.extent;
      const overview = OVERVIEW_LEVEL * window.devicePixelRatio;
      jobs.unshift({ key: 'overview', x: 0, y: 0, width: right, height: bottom, scale: overview });
    }
    this.evict();
    const signature = jobs.map((job) => `${job.key}@${job.scale}`).join(' ');
    if (signature === this.signature) return;
    this.signature = signature;
    this.sent++;
    this.post({ type: 'jobs', jobs, seq: this.sent });
  }

  private forTiles(view: number[], margin: number, visit: (key: string, x: number, y: number) => void): void {
    const [right, bottom] = this.extent;
    const first = [view[0], view[1]].map((edge) => Math.max(0, Math.floor(edge / TILE) - margin));
    const last = [
      Math.min(Math.floor(right / TILE), Math.floor(view[2] / TILE) + margin),
      Math.min(Math.floor(bottom / TILE), Math.floor(view[3] / TILE) + margin),
    ];
    for (let ty = first[1]; ty <= last[1]; ty++) {
      for (let tx = first[0]; tx <= last[0]; tx++) visit(`${tx},${ty}`, tx * TILE, ty * TILE);
    }
  }

  private evict(): void {
    for (const [key, tile] of this.tiles) {
      if (this.keep.has(key)) continue;
      tile.canvas?.remove();
      this.tiles.delete(key);
    }
  }

  private receive(message: FromWorker): void {
    if (message.type === 'idle') {
      this.finished = message.seq;
      if (this.finished === this.sent) this.waiters.splice(0).forEach((resolve) => resolve());
      return;
    }
    if (message.type !== 'tile') return;
    const { job, bitmap } = message;
    this.renderMs.push(message.ms);
    if (job.key === 'overview') {
      this.overviewDone = true;
      if (bitmap) this.show(placeCanvas('ink-overview', 0, 0, job.width, job.height), bitmap, true);
      return;
    }
    if (!this.keep.has(job.key)) {
      bitmap?.close();
      return;
    }
    const tile = this.tiles.get(job.key) ?? { canvas: null, scale: 0 };
    this.tiles.set(job.key, tile);
    tile.scale = job.scale;
    if (!bitmap) return;
    tile.canvas ??= placeCanvas('ink-tile', job.x, job.y, TILE, TILE);
    this.show(tile.canvas, bitmap, false);
  }

  private show(canvas: HTMLCanvasElement, bitmap: ImageBitmap, underneath: boolean): void {
    if (!canvas.isConnected) {
      if (underneath) this.container.prepend(canvas);
      else this.container.append(canvas);
    }
    canvas.getContext('bitmaprenderer')?.transferFromImageBitmap(bitmap);
  }

  /** Resolves once the worker has drawn everything asked of it so far, or after `timeout` milliseconds. */
  whenIdle(timeout: number): Promise<void> {
    if (this.finished === this.sent) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      setTimeout(resolve, timeout);
    });
  }

  takeRenderMs(): number[] {
    return this.renderMs.splice(0);
  }

  destroy(): void {
    this.worker.terminate();
    this.container.remove();
    this.tiles.clear();
  }
}
