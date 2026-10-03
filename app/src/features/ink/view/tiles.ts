// The tile cache for finished strokes (design 6.5): canvases of 256 by 256 device pixels that the tile planner
// chooses, drawn in slices of a few milliseconds per frame. Tiles sit in one layer whose transform follows the
// camera, so a scroll or a zoom moves one element and redraws nothing until the planner asks for sharper tiles.
import { grow, intersects } from '../geometry/bounds';
import type { Bounds } from '../geometry/types';
import type { InkStroke } from '../model/types';
import { tileBudget } from '../engine/tiles/budget';
import { TILE_PX, tileBounds, tileSpan } from '../engine/tiles/grid';
import { planTiles, visibleTileCount } from '../engine/tiles/planner';
import type { TileInfo, TileJob } from '../engine/tiles/planner';
import type { ColorScheme } from '../pens/palette';
import type { InkCamera } from './host';
import { paintStrokes } from './paint';

/** The most ink can reach past a stroke's centerline box, in page units: half the widest pen, rounded up. */
export const INK_MARGIN = 48;
/** The drawing slice per frame, in milliseconds. */
const SLICE_MS = 6;

export interface TileSource {
  query(box: Bounds): InkStroke[];
  /** How far the widest stroke shown reaches past its centerline box, in page units; at most INK_MARGIN. */
  margin(): number;
  scheme(): ColorScheme;
  penDown(): boolean;
}

interface Tile {
  info: TileInfo;
  canvas: HTMLCanvasElement | null;
}

export interface TileStats {
  readonly held: number;
  readonly drawn: number;
  readonly pending: number;
  /** The slowest tile drawn and the slowest plan, in milliseconds. */
  readonly slowestTileMs: number;
  readonly slowestPlanMs: number;
}

export class TileLayer {
  readonly element: HTMLDivElement;
  private readonly tiles = new Map<string, Tile>();
  private readonly pool: HTMLCanvasElement[] = [];
  private camera: InkCamera | null = null;
  private revision = 0;
  private frame = 0;
  private shownScale: number | null = null;
  private queued = 0;
  private drawn = 0;
  private pending = 0;
  private slowestTileMs = 0;
  private slowestPlanMs = 0;
  private stillTimer: ReturnType<typeof setTimeout> | null = null;
  private zoomStill = true;
  private lastZoom = 0;

  constructor(
    parent: HTMLElement,
    private readonly source: TileSource,
  ) {
    this.element = parent.ownerDocument.createElement('div');
    this.element.dataset.inkTiles = '';
    Object.assign(this.element.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0' });
    parent.append(this.element);
  }

  setCamera(camera: InkCamera): void {
    this.camera = camera;
    this.element.style.transform = `translate(${-camera.scrollX}px, ${-camera.scrollY}px) scale(${camera.zoom})`;
    if (camera.zoom !== this.lastZoom) {
      this.lastZoom = camera.zoom;
      this.zoomStill = false;
      if (this.stillTimer) clearTimeout(this.stillTimer);
      this.stillTimer = setTimeout(() => {
        this.zoomStill = true;
        this.schedule();
      }, 150);
    }
    this.schedule();
  }

  /** Makes every tile that meets the box stale. Visible ones redraw now, so new ink shows in this frame. */
  invalidate(box: Bounds, now = true): void {
    const reach = grow(box, this.source.margin());
    for (const tile of this.tiles.values()) {
      const { scale, tx, ty } = tile.info;
      if (intersects(tileBounds(tx, ty, scale), reach)) tile.info = { ...tile.info, revision: -1 };
    }
    if (now) this.run(Infinity, (job) => intersects(tileBounds(job.tx, job.ty, job.scale), reach));
    this.schedule();
  }

  /** A theme change: every tile is stale. */
  invalidateAll(): void {
    this.revision += 1;
    this.schedule();
  }

  stats(): TileStats {
    const { drawn, pending, slowestTileMs, slowestPlanMs } = this;
    return { held: this.tiles.size, drawn, pending, slowestTileMs, slowestPlanMs };
  }

  destroy(): void {
    if (this.queued) cancelAnimationFrame(this.queued);
    if (this.stillTimer) clearTimeout(this.stillTimer);
    this.element.remove();
    this.tiles.clear();
  }

  private schedule(): void {
    if (this.queued) return;
    this.queued = requestAnimationFrame(() => {
      this.queued = 0;
      this.run(SLICE_MS);
    });
  }

  /** Plans, then draws jobs until the slice runs out; `only` limits the drawing to some jobs. */
  private run(sliceMs: number, only?: (job: TileJob) => boolean): void {
    const camera = this.camera;
    if (!camera || camera.viewport.w <= 0) return;
    const viewport: Bounds = {
      minX: camera.scrollX / camera.zoom,
      minY: camera.scrollY / camera.zoom,
      maxX: (camera.scrollX + camera.viewport.w) / camera.zoom,
      maxY: (camera.scrollY + camera.viewport.h) / camera.zoom,
    };
    const scale = camera.zoom * camera.dpr;
    const infos = new Map([...this.tiles].map(([id, tile]) => [id, tile.info]));
    this.frame += 1;
    const planning = performance.now();
    const plan = planTiles({
      viewport,
      zoom: camera.zoom,
      devicePixelRatio: camera.dpr,
      zoomStill: this.zoomStill,
      shownScale: this.shownScale,
      tiles: infos,
      revision: this.revision,
      penDown: this.source.penDown(),
      budget: tileBudget({ visibleTiles: visibleTileCount(viewport, scale) }),
      frame: this.frame,
      hasInk: (rect) => this.source.query(grow(rect, this.source.margin())).length > 0,
    });
    this.slowestPlanMs = Math.max(this.slowestPlanMs, performance.now() - planning);
    this.shownScale = plan.scale;
    for (const id of plan.evict) this.evict(id);
    for (const job of plan.empty) this.store(job, null);
    const started = performance.now();
    let left = 0;
    for (const job of plan.jobs) {
      if (only && !only(job)) continue;
      if (performance.now() - started > sliceMs) {
        left += 1;
        continue;
      }
      this.draw(job);
    }
    this.pending = left;
    const visible = new Set(plan.visible);
    for (const [id, tile] of this.tiles) {
      if (!tile.canvas) continue;
      const show = plan.overview ? tile.info.revision >= 0 : visible.has(id);
      tile.canvas.style.display = show ? '' : 'none';
    }
    if (!only && left > 0) this.schedule();
  }

  private store(job: TileJob, canvas: HTMLCanvasElement | null): void {
    const old = this.tiles.get(job.id);
    if (old?.canvas && old.canvas !== canvas) this.release(old.canvas);
    const status = canvas ? 'ready' : 'empty';
    const info: TileInfo = {
      scale: job.scale,
      tx: job.tx,
      ty: job.ty,
      status,
      revision: this.revision,
      lastUsed: this.frame,
    };
    this.tiles.set(job.id, { info, canvas });
  }

  private draw(job: TileJob): void {
    const started = performance.now();
    const canvas = this.tiles.get(job.id)?.canvas ?? this.pool.pop() ?? this.make();
    const span = tileSpan(job.scale);
    Object.assign(canvas.style, {
      left: `${job.tx * span}px`,
      top: `${job.ty * span}px`,
      width: `${span}px`,
      height: `${span}px`,
    });
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, TILE_PX, TILE_PX);
      ctx.setTransform(job.scale, 0, 0, job.scale, -job.tx * TILE_PX, -job.ty * TILE_PX);
      const box = tileBounds(job.tx, job.ty, job.scale);
      paintStrokes(ctx, this.source.query(grow(box, this.source.margin())), this.source.scheme());
    }
    if (!canvas.parentElement) this.element.append(canvas);
    this.drawn += 1;
    this.store(job, canvas);
    this.slowestTileMs = Math.max(this.slowestTileMs, performance.now() - started);
  }

  private make(): HTMLCanvasElement {
    const canvas = this.element.ownerDocument.createElement('canvas');
    canvas.width = TILE_PX;
    canvas.height = TILE_PX;
    canvas.style.position = 'absolute';
    return canvas;
  }

  private release(canvas: HTMLCanvasElement): void {
    canvas.style.display = 'none';
    if (this.pool.length < 32) this.pool.push(canvas);
    else canvas.remove();
  }

  private evict(id: string): void {
    const tile = this.tiles.get(id);
    if (tile?.canvas) this.release(tile.canvas);
    this.tiles.delete(id);
  }
}
