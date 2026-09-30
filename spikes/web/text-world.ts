// The zoomable, pannable world of the text spike. One container holds the notes (and SVG ink), and a single
// CSS transform (translate, then scale) places it in the window. Ctrl+wheel zooms around the pointer; the
// wheel, a middle-button drag, or Space+drag pans.

/** Where the world sits: a screen point is `world * scale + (x, y)`, in CSS pixels. */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export class World {
  camera: Camera = { x: 0, y: 0, scale: 1 };
  private readonly listeners: ((camera: Camera) => void)[] = [];

  constructor(
    readonly viewport: HTMLElement,
    readonly element: HTMLElement,
  ) {}

  /** Calls `listener` after every camera change, in the same frame. */
  onChange(listener: (camera: Camera) => void): void {
    this.listeners.push(listener);
  }

  set(camera: Camera): void {
    this.camera = { x: camera.x, y: camera.y, scale: clampScale(camera.scale) };
    const { x, y, scale } = this.camera;
    this.element.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    for (const listener of this.listeners) listener(this.camera);
  }

  /** Zooms to `scale`, keeping the world point under the screen point (sx, sy) still. */
  zoomAt(scale: number, sx: number, sy: number): void {
    const next = clampScale(scale);
    const ratio = next / this.camera.scale;
    this.set({ x: sx - (sx - this.camera.x) * ratio, y: sy - (sy - this.camera.y) * ratio, scale: next });
  }

  panBy(dx: number, dy: number): void {
    this.set({ ...this.camera, x: this.camera.x + dx, y: this.camera.y + dy });
  }

  /** Shows the world point (wx, wy) at the screen point (sx, sy), at `scale`. */
  centerOn(wx: number, wy: number, sx: number, sy: number, scale: number): void {
    const next = clampScale(scale);
    this.set({ x: sx - wx * next, y: sy - wy * next, scale: next });
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.camera.x) / this.camera.scale, (sy - this.camera.y) / this.camera.scale];
  }

  /** Promotes the world to its own compositor layer with `will-change: transform`, or stops doing so. */
  setLayer(on: boolean): void {
    this.element.classList.toggle('layer', on);
  }

  get size(): [number, number] {
    return [this.viewport.clientWidth, this.viewport.clientHeight];
  }
}

function inEditor(): boolean {
  return document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable;
}

/** Adds the mouse, wheel, and keyboard controls for zooming and panning. */
export function attachControls(world: World): void {
  const { viewport } = world;
  let spaceHeld = false;
  let dragging: { x: number; y: number } | null = null;
  viewport.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (event.ctrlKey)
        world.zoomAt(world.camera.scale * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
      else world.panBy(-event.deltaX, -event.deltaY);
    },
    { passive: false },
  );
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !inEditor()) {
      spaceHeld = true;
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') spaceHeld = false;
  });
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 1 && !(event.button === 0 && spaceHeld)) return;
    event.preventDefault();
    dragging = { x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    world.panBy(event.clientX - dragging.x, event.clientY - dragging.y);
    dragging = { x: event.clientX, y: event.clientY };
  });
  viewport.addEventListener('pointerup', () => (dragging = null));
  // Stops the middle button from starting the browser's autoscroll.
  viewport.addEventListener('mousedown', (event) => event.button === 1 && event.preventDefault());
}

/** The programmatic motions the harness measures. */
export type Motion = 'zoom' | 'pan' | 'zoom-pan';

export const MOTIONS: readonly Motion[] = ['zoom', 'pan', 'zoom-pan'];

/** Where the world point at the window's center is, and the zoom, `seconds` into a motion. */
export function motionAt(motion: Motion, seconds: number): { wx: number; wy: number; scale: number } {
  const zooming = motion !== 'pan';
  const panning = motion !== 'zoom';
  // Zoom breathes between 30% and 250% every 2 seconds, evenly in log scale.
  const phase = (1 - Math.cos((2 * Math.PI * seconds) / 2)) / 2;
  const scale = zooming ? Math.exp(Math.log(0.3) + (Math.log(2.5) - Math.log(0.3)) * phase) : 1;
  // Panning sweeps a figure across the notes and ink at up to about 2,000 pixels a second.
  const wx = panning ? 1500 + 1100 * Math.sin((2 * Math.PI * seconds) / 3.2) : 1500;
  const wy = panning ? 1300 + 900 * Math.sin((2 * Math.PI * seconds) / 2.3) : 1100;
  return { wx, wy, scale };
}

/** What one motion run saw: frame intervals from requestAnimationFrame, and the main thread's time per frame. */
export interface MotionReport {
  motion: Motion;
  ms: number;
  frames: number;
  intervals: number[];
  /** From each frame's start to the end of its rendering on the main thread (style, layout, and paint). */
  mainThread: number[];
  longAnimationFrames: number;
}

/** Runs a motion for `ms` milliseconds, one camera change per frame. */
export function runMotion(world: World, motion: Motion, ms: number): Promise<MotionReport> {
  const report: MotionReport = { motion, ms, frames: 0, intervals: [], mainThread: [], longAnimationFrames: 0 };
  const observer = new PerformanceObserver((list) => (report.longAnimationFrames += list.getEntries().length));
  try {
    observer.observe({ type: 'long-animation-frame' });
  } catch {
    report.longAnimationFrames = -1;
  }
  return new Promise((resolve) => {
    let start = -1;
    let last = -1;
    const frame = (time: number) => {
      if (start < 0) start = time;
      if (last >= 0) report.intervals.push(time - last);
      last = time;
      report.frames++;
      const [width, height] = world.size;
      const { wx, wy, scale } = motionAt(motion, (time - start) / 1000);
      world.centerOn(wx, wy, width / 2, height / 2, scale);
      const channel = new MessageChannel();
      channel.port1.onmessage = () => report.mainThread.push(performance.now() - time);
      channel.port2.postMessage(null);
      if (time - start < ms) {
        requestAnimationFrame(frame);
        return;
      }
      setTimeout(() => {
        observer.disconnect();
        resolve(report);
      }, 50);
    };
    requestAnimationFrame(frame);
  });
}
