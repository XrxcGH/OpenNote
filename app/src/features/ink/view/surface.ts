// One page's ink: its strokes, the overlay that shows them, and the edits that change them. The overlay sits over
// the page viewport in screen space: a layer of cached tiles for finished strokes, and a live canvas for the
// stroke in progress, the eraser, and the lasso. Each change shows at once and goes to the core through the page's
// sync queue, so it joins the page's undo history. A change the core refuses is taken back from the picture.
import { decodeRecords, encodeRecords } from '../../../core/ink/codec';
import type { InkRecord } from '../../../core/ink/codec';
import { newId } from '../../../editor/ids';
import type { InkChanges, StrokeMatrix, StrokeStyleEdit } from '../../../services/pages/ink';
import type { BlockJson, Edit, EditBatch, OpenPage } from '../../../services/pages/types';
import { settingsStore } from '../../../state/settings';
import { osStore } from '../../../state/os';
import { t } from '../../../strings/t';
import { currentTheme } from '../../../theme/theme';
import { showToast } from '../../../ui';
import { intersects, strokeBounds, union } from '../geometry/bounds';
import { compose } from '../geometry/matrix';
import { createStrokeIndex, halfWidth } from '../geometry/strokeIndex';
import type { StrokeIndex } from '../geometry/strokeIndex';
import type { Bounds, Matrix } from '../geometry/types';
import { recordFromStroke, strokeFromRecord } from '../model/convert';
import type { InkStroke } from '../model/types';
import type { ColorScheme } from '../pens/palette';
import { maxWidthFactor } from '../pens/width';
import type { InkBlockLayer, InkCamera, InkQueue, InkViewport } from './host';
import { fillOf, outlineOf, strokePath } from './paint';
import type { PenStyle } from './state';
import { INK_MARGIN, TileLayer } from './tiles';

export interface SurfaceParts {
  readonly page: OpenPage;
  readonly viewport: InkViewport;
  readonly queue: InkQueue;
  readonly layer: InkBlockLayer | null;
}

const isLayer = (block: BlockJson) => block.type === 'ink' && (block.data.role ?? 'layer') === 'layer';

export class InkSurface {
  readonly overlay: HTMLDivElement;
  readonly index: StrokeIndex = createStrokeIndex();
  readonly tiles: TileLayer;
  readonly live: HTMLCanvasElement;
  /** Where lasso handles go, in screen space. */
  readonly chrome: HTMLDivElement;
  private readonly liveCtx: CanvasRenderingContext2D | null;
  private readonly stops: (() => void)[] = [];
  private camera: InkCamera;
  private layerId: string | null = null;
  private pendingLayer: BlockJson | null = null;
  private down = false;
  private size = { w: 0, h: 0, dpr: 0 };
  private extent: Bounds | null = null;
  private warming: InkStroke[] | null = null;
  /** How far the widest stroke shown reaches past its centerline box: tiles query no farther. */
  private reach = 1;
  private readonly listeners = new Set<() => void>();
  /** A gesture's view of the ink before the core has it: strokes it hides, and strokes it shows outside the index. */
  private readonly hidden = new Set<string>();
  private readonly extra = new Map<string, InkStroke>();

  constructor(readonly parts: SurfaceParts) {
    const { viewport } = parts;
    const doc = viewport.viewport.ownerDocument;
    this.overlay = doc.createElement('div');
    this.overlay.dataset.inkOverlay = '';
    this.overlay.setAttribute('aria-hidden', 'true');
    Object.assign(this.overlay.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      contain: 'strict',
    });
    viewport.viewport.after(this.overlay);
    this.tiles = new TileLayer(this.overlay, {
      query: (box) => this.query(box),
      margin: () => this.reach,
      scheme: () => this.scheme(),
      penDown: () => this.down,
    });
    this.live = doc.createElement('canvas');
    this.live.dataset.inkLive = '';
    Object.assign(this.live.style, { position: 'absolute', left: '0', top: '0' });
    this.overlay.append(this.live);
    this.liveCtx = this.live.getContext('2d', { desynchronized: true }) as CanvasRenderingContext2D | null;
    this.chrome = doc.createElement('div');
    this.chrome.dataset.inkChrome = '';
    Object.assign(this.chrome.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' });
    viewport.viewport.parentElement?.append(this.chrome);
    this.camera = viewport.camera();
    this.findLayer();
    this.stops.push(
      viewport.onCamera((camera) => this.setCamera(camera)),
      parts.page.ink?.onChange((changes) => this.applyChanges(changes)) ?? (() => undefined),
      themeChanges(() => this.tiles.invalidateAll()),
    );
    this.load();
    this.setCamera(this.camera);
  }

  /** Strokes whose outlines still wait to be built in idle time. */
  get warmingLeft(): number {
    return this.warming?.length ?? 0;
  }

  get readOnly(): boolean {
    return this.parts.page.readOnly !== null || !this.parts.page.ink;
  }

  scheme(): ColorScheme {
    return currentTheme() === 'dark' ? 'dark' : 'light';
  }

  cameraNow(): InkCamera {
    return this.camera;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  setPenDown(down: boolean): void {
    this.down = down;
  }

  strokes(ids: readonly string[]): InkStroke[] {
    return ids.flatMap((id) => {
      const stroke = this.index.get(id);
      return stroke ? [stroke as InkStroke] : [];
    });
  }

  /** The ink layer the next stroke goes to, made on first use. */
  layerFor(): string {
    if (this.layerId) return this.layerId;
    if (this.pendingLayer) return this.pendingLayer.id;
    const now = new Date().toISOString();
    this.pendingLayer = {
      id: newId(),
      type: 'ink',
      order: 'zz',
      frame: { x: 0, y: 0 },
      created: now,
      modified: now,
      data: { role: 'layer' },
    };
    return this.pendingLayer.id;
  }

  // ---- the picture ----

  /** The strokes that meet a box, as the picture shows them now. */
  query(box: Bounds): InkStroke[] {
    const found = (this.index.query(box) as InkStroke[]).filter((stroke) => !this.hidden.has(stroke.id));
    for (const stroke of this.extra.values()) if (intersects(strokeBounds(stroke), box)) found.push(stroke);
    return found;
  }

  /** A gesture's picture: strokes to hide and strokes to show, without touching the index. */
  preview(hide: readonly string[], show: readonly InkStroke[], drop: readonly string[] = []): void {
    let box: Bounds | null = null;
    const add = (b: Bounds) => (box = box ? union(box, b) : b);
    for (const id of hide) {
      const stroke = this.index.get(id) ?? this.extra.get(id);
      if (stroke) add(strokeBounds(stroke));
      if (this.extra.delete(id)) continue;
      this.hidden.add(id);
    }
    for (const id of drop) {
      const stroke = this.extra.get(id);
      if (stroke) add(strokeBounds(stroke));
      this.extra.delete(id);
    }
    this.widen(show);
    for (const stroke of show) {
      this.extra.set(stroke.id, stroke);
      add(strokeBounds(stroke));
    }
    if (box) this.changed(box);
  }

  /** Ends a gesture's picture, showing the index as it is. */
  endPreview(): void {
    let box: Bounds | null = null;
    const add = (b: Bounds) => (box = box ? union(box, b) : b);
    for (const id of this.hidden) {
      const stroke = this.index.get(id);
      if (stroke) add(strokeBounds(stroke));
    }
    for (const stroke of this.extra.values()) add(strokeBounds(stroke));
    this.hidden.clear();
    this.extra.clear();
    if (box) this.changed(box);
  }

  /** Sends a batch; on a refusal, `undo` puts the picture back and a toast says so. */
  async send(batch: EditBatch, undo: () => void): Promise<boolean> {
    try {
      await this.parts.queue.send(batch);
      return true;
    } catch {
      undo();
      notSaved();
      return false;
    }
  }

  /** Records for new strokes. */
  records(strokes: readonly InkStroke[]): Uint8Array {
    return encodeRecords(strokes.map((stroke): InkRecord => ({ kind: 'stroke', stroke: recordFromStroke(stroke) })));
  }

  /** The edit that makes the ink layer, when the next stroke is the page's first. */
  takeLayerEdit(): Edit[] {
    const layer = this.pendingLayer;
    if (!layer) return [];
    this.layerId = layer.id;
    this.pendingLayer = null;
    this.parts.layer?.upsert(layer);
    return [{ edit: 'insertBlock', block: { id: layer.id, type: 'ink', frame: layer.frame, data: layer.data } }];
  }

  /** Puts strokes in the picture (or replaces them) and redraws what they touch. */
  show(strokes: readonly InkStroke[]): void {
    let box: Bounds | null = null;
    this.widen(strokes);
    for (const stroke of strokes) {
      const before = this.index.get(stroke.id);
      if (before) box = box ? union(box, strokeBounds(before)) : strokeBounds(before);
      this.index.put(stroke);
      box = box ? union(box, strokeBounds(stroke)) : strokeBounds(stroke);
    }
    if (box) this.changed(box);
  }

  hide(ids: readonly string[]): InkStroke[] {
    const gone: InkStroke[] = [];
    let box: Bounds | null = null;
    for (const id of ids) {
      const stroke = this.index.get(id) as InkStroke | undefined;
      if (!stroke) continue;
      this.index.remove(id);
      gone.push(stroke);
      box = box ? union(box, strokeBounds(stroke)) : strokeBounds(stroke);
    }
    if (box) this.changed(box);
    return gone;
  }

  private widen(strokes: Iterable<InkStroke>): void {
    for (const stroke of strokes) {
      const reach = halfWidth(stroke) * maxWidthFactor(stroke.tool) + 1;
      if (reach > this.reach) this.reach = Math.min(INK_MARGIN, reach);
    }
  }

  private changed(box: Bounds): void {
    this.tiles.invalidate(box);
    this.extent = this.extent ? union(this.extent, box) : box;
    this.growWorld();
    this.listeners.forEach((listener) => listener());
  }

  // ---- edits ----

  /** New strokes, with any edits that go before them, as one undo step. */
  add(strokes: readonly InkStroke[], edits: Edit[] = [], coalesce?: EditBatch['coalesce']): Promise<boolean> {
    if (strokes.length === 0 && edits.length === 0) return Promise.resolve(true);
    const made = this.pendingLayer !== null;
    const before = this.takeLayerEdit();
    this.show(strokes);
    const batch: EditBatch = { edits: [...before, ...edits], coalesce };
    if (strokes.length > 0) batch.strokes = this.records(strokes);
    return this.send(batch, () => {
      this.hide(strokes.map((stroke) => stroke.id));
      if (made) this.layerId = null;
    });
  }

  remove(ids: readonly string[], coalesce?: EditBatch['coalesce']): Promise<boolean> {
    if (ids.length === 0) return Promise.resolve(true);
    const gone = this.hide(ids);
    return this.send({ edits: [{ edit: 'removeStrokes', strokes: [...ids] }], coalesce }, () => this.show(gone));
  }

  /** Moves, resizes, or rotates strokes; blocks move in the same step through `edits`. */
  transform(ids: readonly string[], matrix: Matrix, edits: Edit[] = []): Promise<boolean> {
    const before = this.strokes(ids);
    this.show(before.map((stroke) => ({ ...stroke, transform: compose(matrix, stroke.transform ?? IDENTITY_M) })));
    const strokeEdits: Edit[] =
      ids.length > 0 ? [{ edit: 'transformStrokes', strokes: [...ids], matrix: [...matrix] as StrokeMatrix }] : [];
    return this.send({ edits: [...strokeEdits, ...edits] }, () => this.show(before));
  }

  restyle(ids: readonly string[], next: readonly InkStroke[], style: StrokeStyleEdit): Promise<boolean> {
    const before = this.strokes(ids);
    this.show(next);
    return this.send({ edits: [{ edit: 'restyleStrokes', strokes: [...ids], style }] }, () => this.show(before));
  }

  /** An undo, a redo, or another window's change. */
  applyChanges(changes: InkChanges): void {
    this.hide(changes.removed);
    const strokes = decodeRecords(changes.records, { verify: false }).flatMap((record) =>
      record.kind === 'stroke' ? [strokeFromRecord(record.stroke)] : [],
    );
    this.show(strokes);
    if (!this.layerId) this.findLayer();
  }

  // ---- the live canvas ----

  /** Clears the live canvas and sets it up for page units. */
  liveContext(): CanvasRenderingContext2D | null {
    const ctx = this.liveCtx;
    if (!ctx) return null;
    const { zoom, dpr, scrollX, scrollY } = this.camera;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.live.width, this.live.height);
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -scrollX * dpr, -scrollY * dpr);
    return ctx;
  }

  /** Draws a stroke in progress on the live canvas. */
  drawLive(points: Parameters<typeof outlineOf>[0], style: PenStyle, complete = false): void {
    const ctx = this.liveContext();
    if (!ctx || points.length === 0) return;
    ctx.fillStyle = fillOf(style, this.scheme());
    ctx.fill(outlineOf(points, style.tool, style.width, complete));
  }

  clearLive(): void {
    this.liveContext();
  }

  destroy(): void {
    this.warming = null;
    this.stops.splice(0).forEach((stop) => stop());
    this.tiles.destroy();
    this.overlay.remove();
    this.chrome.remove();
  }

  // ---- setup ----

  private findLayer(): void {
    const layer = this.parts.layer?.blocks().find(isLayer) ?? this.parts.page.initial.blocks.find(isLayer);
    this.layerId = layer?.id ?? null;
  }

  private load(): void {
    const ink = this.parts.page.ink;
    if (!ink) return;
    this.loadRecords(ink.records);
    if (ink.more) void ink.readAll().then((records) => this.loadRecords(records));
  }

  private loadRecords(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    const strokes: InkStroke[] = [];
    for (const record of decodeRecords(bytes, { verify: false })) {
      if (record.kind !== 'stroke') continue;
      try {
        strokes.push(strokeFromRecord(record.stroke));
      } catch {
        // A stroke the codec can't read stays in the file, untouched, and doesn't draw.
      }
    }
    for (const stroke of strokes) this.index.put(stroke);
    this.widen(strokes);
    this.warm(strokes);
    const box = strokes.reduce<Bounds | null>((acc, s) => (acc ? union(acc, strokeBounds(s)) : strokeBounds(s)), null);
    if (box) this.changed(box);
  }

  /**
   * Builds the outlines of loaded strokes in idle time, nearest the view first, so a scroll into a dense page only
   * fills paths and never shapes them inside a frame.
   */
  private warm(strokes: readonly InkStroke[]): void {
    const { scrollX, scrollY, zoom, viewport } = this.camera;
    const cx = (scrollX + viewport.w / 2) / zoom;
    const cy = (scrollY + viewport.h / 2) / zoom;
    const near = (s: InkStroke) => {
      const b = strokeBounds(s);
      return Math.abs((b.minX + b.maxX) / 2 - cx) + Math.abs((b.minY + b.maxY) / 2 - cy);
    };
    const queue = [...(this.warming ?? []), ...strokes].sort((a, b) => near(b) - near(a));
    const start = this.warming === null;
    this.warming = queue;
    if (!start) return;
    const step = (deadline?: IdleDeadline) => {
      const list = this.warming;
      if (!list) return;
      // At least a few milliseconds each time: while the page animates, idle time can stay near zero.
      const until = performance.now() + Math.max(3, Math.min(8, deadline?.timeRemaining() ?? 8));
      while (list.length > 0 && performance.now() < until) strokePath(list.pop()!);
      if (list.length === 0) this.warming = null;
      else idle(step);
    };
    idle(step);
  }

  private setCamera(camera: InkCamera): void {
    this.camera = camera;
    const scroller = this.parts.viewport.viewport;
    const w = scroller.clientWidth || camera.viewport.w;
    const h = scroller.clientHeight || camera.viewport.h;
    if (w !== this.size.w || h !== this.size.h || camera.dpr !== this.size.dpr) {
      this.size = { w, h, dpr: camera.dpr };
      Object.assign(this.overlay.style, { width: `${w}px`, height: `${h}px` });
      Object.assign(this.live.style, { width: `${w}px`, height: `${h}px` });
      this.live.width = Math.round(w * camera.dpr);
      this.live.height = Math.round(h * camera.dpr);
    }
    this.tiles.setCamera({ ...camera, viewport: { ...camera.viewport, w, h } });
    this.listeners.forEach((listener) => listener());
  }

  /** The ink block's wrapper takes the ink's size, so the world grows to hold the ink and the page scrolls to it. */
  private growWorld(): void {
    const element = this.layerId ? this.parts.layer?.view(this.layerId)?.element : null;
    if (!element || !this.extent) return;
    // The wrapper covers the ink, which covers text: it must never take a click meant for the text below.
    element.style.pointerEvents = 'none';
    element.style.minWidth = `${Math.max(0, this.extent.maxX + INK_MARGIN)}px`;
    element.style.minHeight = `${Math.max(0, this.extent.maxY + INK_MARGIN)}px`;
  }
}

const IDENTITY_M: Matrix = [1, 0, 0, 1, 0, 0];

type IdleWindow = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadline) => void, options?: { timeout: number }) => number;
};

function idle(callback: (deadline?: IdleDeadline) => void): void {
  const view = window as IdleWindow;
  if (view.requestIdleCallback) view.requestIdleCallback(callback, { timeout: 100 });
  else setTimeout(callback, 16);
}

function notSaved(): void {
  showToast({ id: 'ink-not-saved', message: t('ink.errors.notSaved'), tone: 'danger' });
}

/** Calls back when the shown theme changes. */
function themeChanges(listener: () => void): () => void {
  let last = currentTheme();
  const check = () => {
    const now = currentTheme();
    if (now !== last) {
      last = now;
      listener();
    }
  };
  const stops = [settingsStore.subscribe(check), osStore.subscribe(check)];
  return () => stops.forEach((stop) => stop());
}
