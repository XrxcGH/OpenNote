// The ink layer for the text spike, drawn one of four ways. The "svg" mode puts one SVG path per stroke inside
// the zoomed world, under the notes. The "canvas" mode draws on a canvas the size of the window, redrawn whenever
// the camera moves. The "tiles" mode shows tiles a worker draws once, which then move and scale with the world
// (see text-ink-tiles.ts). The "off" mode shows no ink.
import { TileInk } from './text-ink-tiles';
import { extent, overlaps, type Stroke } from './text-strokes';
import type { Camera } from './text-world';

export type InkMode = 'off' | 'svg' | 'canvas' | 'tiles';

export const INK_MODES: readonly InkMode[] = ['off', 'svg', 'canvas', 'tiles'];

const SVG = 'http://www.w3.org/2000/svg';

export class InkLayer {
  mode: InkMode = 'off';
  private svg: SVGSVGElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private tiles: TileInk | null = null;
  private paths: Path2D[] = [];
  /** Milliseconds the last canvas redraw took, for the live panel. */
  lastDrawMs = 0;

  constructor(
    private readonly strokes: Stroke[],
    private readonly world: HTMLElement,
    private readonly viewport: HTMLElement,
  ) {}

  get count(): number {
    return this.strokes.length;
  }

  setMode(mode: InkMode, camera: Camera): void {
    if (mode === this.mode) return;
    this.svg?.remove();
    this.canvas?.remove();
    this.tiles?.destroy();
    [this.svg, this.canvas, this.tiles] = [null, null, null];
    this.mode = mode;
    if (mode === 'svg') this.svg = this.buildSvg();
    if (mode === 'canvas') this.canvas = this.buildCanvas();
    if (mode === 'tiles') this.tiles = new TileInk(this.world, this.strokes.length, extent(this.strokes));
    this.draw(camera);
  }

  /** Resolves when the ink is fully drawn for the current view (only tiles draw in the background). */
  settled(timeout = 10_000): Promise<void> {
    return this.tiles ? this.tiles.whenIdle(timeout) : Promise.resolve();
  }

  /** Milliseconds each tile took in the worker since the last call. Empty for other modes. */
  takeTileMs(): number[] {
    return this.tiles?.takeRenderMs() ?? [];
  }

  private buildSvg(): SVGSVGElement {
    const svg = document.createElementNS(SVG, 'svg');
    svg.classList.add('ink-svg');
    const [right, bottom] = extent(this.strokes);
    svg.setAttribute('width', String(right));
    svg.setAttribute('height', String(bottom));
    svg.innerHTML = this.strokes.map((stroke) => `<path d="${stroke.path}" fill="${stroke.color}"/>`).join('');
    this.world.prepend(svg);
    return svg;
  }

  private buildCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.id = 'ink-canvas';
    if (this.paths.length === 0) this.paths = this.strokes.map((stroke) => new Path2D(stroke.path));
    this.viewport.prepend(canvas);
    return canvas;
  }

  /** Keeps the ink in step with the camera. SVG ink moves with the world, so it needs nothing. */
  draw(camera: Camera): void {
    const [width, height] = [this.viewport.clientWidth, this.viewport.clientHeight];
    this.tiles?.update(camera, width, height);
    if (this.canvas) this.drawCanvas(this.canvas, camera, width, height);
  }

  private drawCanvas(canvas: HTMLCanvasElement, camera: Camera, width: number, height: number): void {
    const started = performance.now();
    const ratio = window.devicePixelRatio;
    if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
    if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const { x, y, scale } = camera;
    context.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * x, ratio * y);
    const view = [-x / scale, -y / scale, (width - x) / scale, (height - y) / scale];
    this.strokes.forEach((stroke, index) => {
      if (!overlaps(stroke, view[0], view[1], view[2], view[3])) return;
      context.fillStyle = stroke.color;
      context.fill(this.paths[index]);
    });
    this.lastDrawMs = performance.now() - started;
  }
}
