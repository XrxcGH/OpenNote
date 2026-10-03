// The zoom writing box: a magnified strip docks at the bottom of the page pane, the person writes large in it, and the ink
// lands small in a box on the page. The box moves along the line by itself once the pen reaches its right quarter, wraps
// to the next line at the right margin, and the arrow keys, Home, End, and Enter move it by hand. In left-handed mode the
// controls sit on the left. The strip is a second input surface: its points map to page units by the box's place and the
// magnification, and strokes are stored as ordinary ink of the page.
import { newId } from '../../../editor/ids';
import { isEnabled } from '../../../app/flags';
import { getSettings } from '../../../state/settings';
import type { Store } from '../../../state/store';
import { t } from '../../../strings/t';
import { announce, buttonClass } from '../../../ui';
import { strokeBounds } from '../geometry/bounds';
import type { Bounds, Vec } from '../geometry/types';
import { createStrokeBuilder } from '../input/strokeBuilder';
import type { StrokeBuilder } from '../input/strokeBuilder';
import {
  ADVANCE_DELAY_MS,
  advance,
  boxAt,
  boxBounds,
  lineNumber,
  moveBox,
  newLine,
  revealDelta,
  shouldAdvance,
  stripHeight,
  stripToPage,
} from '../zoombox';
import type { BoxKey, Magnification, Margins, Strip, ZoomBox } from '../zoombox';
import type { InkStroke } from '../model/types';
import type { InkHost, InkPointerTool } from './host';
import { paintStrokes, fillOf, outlineOf } from './paint';
import { penFeel } from './penFeel';
import { inkPrefs, penKeyOf, setPrefs } from './prefs';
import { activeSlot, styleOf } from './state';
import type { InkSurface } from './surface';

const SIDE_MARGIN = 40;
const KEYS: Readonly<Record<string, BoxKey>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
};

export function toggleZoomBox(): void {
  const next = !inkPrefs.get().zoomBox;
  setPrefs({ zoomBox: next });
}

class ZoomBoxView {
  readonly element: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  private readonly marker: HTMLDivElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly stops: (() => void)[] = [];
  private box: ZoomBox;
  private builder: StrokeBuilder | null = null;
  private pointerId: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private strip: Strip = { origin: { x: 0, y: 0 }, width: 0, height: 0 };
  private firstTop = 0;

  constructor(
    private readonly host: InkHost,
    private readonly surface: InkSurface,
  ) {
    const doc = surface.chrome.ownerDocument;
    this.element = doc.createElement('div');
    this.element.dataset.inkZoombox = '';
    this.element.dataset.scope = 'zoomBox';
    this.element.setAttribute('role', 'group');
    this.element.setAttribute('aria-label', t('ink.zoomBox.label'));
    this.element.tabIndex = 0;
    Object.assign(this.element.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      bottom: '0',
      display: 'flex',
      gap: 'var(--space-3)',
      padding: 'var(--space-3)',
      borderTop: '2px solid var(--color-accent-primary)',
      background: 'var(--color-surface-app)',
      pointerEvents: 'auto',
      zIndex: '3',
      boxSizing: 'border-box',
    });
    this.canvas = doc.createElement('canvas');
    this.canvas.dataset.inkZoomStrip = '';
    Object.assign(this.canvas.style, {
      flex: '1',
      minWidth: '0',
      height: '100%',
      touchAction: 'none',
      background: 'var(--color-surface-page)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-md)',
    });
    this.ctx = this.canvas.getContext('2d');
    const controls = doc.createElement('div');
    Object.assign(controls.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)',
      justifyContent: 'center',
    });
    const button = (label: string, run: () => void) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = buttonClass('secondary');
      b.textContent = label;
      b.addEventListener('click', run);
      return b;
    };
    controls.append(
      button(t('ink.zoomBox.next'), () => this.step()),
      button(t('ink.zoomBox.newLine'), () => this.lineBreak()),
      button(t('ink.zoomBox.close'), () => setPrefs({ zoomBox: false })),
    );
    // Left-handed mode mirrors the strip: the controls go to the left, under the hand that is not writing.
    this.element.style.flexDirection = getSettings().ink.handedness === 'left' ? 'row-reverse' : 'row';
    this.element.append(this.canvas, controls);
    this.element.addEventListener('keydown', this.onKey);
    this.marker = doc.createElement('div');
    this.marker.dataset.inkZoomBox = '';
    this.marker.setAttribute('aria-hidden', 'true');
    Object.assign(this.marker.style, {
      position: 'absolute',
      pointerEvents: 'none',
      border: '2px solid var(--color-accent-primary)',
      borderRadius: 'var(--radius-sm)',
      background: 'color-mix(in srgb, var(--color-accent-primary) 8%, transparent)',
      zIndex: '2',
    });
    surface.chrome.append(this.marker, this.element);
    this.box = this.start();
    this.firstTop = this.box.origin.y;
    this.stops.push(surface.onChange(() => this.render()));
    this.render();
    announce(t('ink.zoomBox.on', { line: lineNumber(this.box, this.firstTop) }));
    this.element.focus({ preventScroll: true });
  }

  private settings() {
    const box = getSettings().ink.zoomBox;
    return {
      magnification: ([2, 3, 4].includes(box.magnification) ? box.magnification : 3) as Magnification,
      auto: box.autoAdvance,
    };
  }

  private margins(): Margins {
    const { zoom, scrollX, viewport } = this.surface.cameraNow();
    return { left: SIDE_MARGIN, right: Math.max(SIDE_MARGIN * 3, (scrollX + viewport.w) / zoom - SIDE_MARGIN) };
  }

  private stripSize() {
    const camera = this.surface.cameraNow();
    return {
      width: Math.max(1, this.element.clientWidth - this.controlsWidth()),
      height: stripHeight(camera.viewport.h),
    };
  }

  private controlsWidth(): number {
    return (this.element.lastElementChild as HTMLElement | null)?.offsetWidth ?? 120;
  }

  /** The first place the box sits: the left margin, a little below the top of the view. */
  private start(): ZoomBox {
    const { zoom, scrollY } = this.surface.cameraNow();
    const size = this.stripSize();
    return boxAt({ x: SIDE_MARGIN, y: (scrollY + 80) / zoom }, size, this.settings().magnification, zoom);
  }

  /** Redraws the box on the page and the ink under it in the strip. */
  render(): void {
    const camera = this.surface.cameraNow();
    const { zoom, scrollX, scrollY, dpr } = camera;
    const m = this.settings().magnification;
    const height = stripHeight(camera.viewport.h);
    this.element.style.height = `${height}px`;
    const rect = this.canvas.getBoundingClientRect();
    this.strip = { origin: { x: rect.left, y: rect.top }, width: rect.width, height: rect.height };
    const resized = boxAt(this.box.origin, this.strip, m, zoom);
    this.box = resized;
    Object.assign(this.marker.style, {
      left: `${resized.origin.x * zoom - scrollX}px`,
      top: `${resized.origin.y * zoom - scrollY}px`,
      width: `${resized.width * zoom}px`,
      height: `${resized.height * zoom}px`,
    });
    const ctx = this.ctx;
    if (!ctx || rect.width === 0) return;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const scale = m * zoom * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(scale, 0, 0, scale, -resized.origin.x * scale, -resized.origin.y * scale);
    paintStrokes(ctx, this.surface.query(boxBounds(resized)), this.surface.scheme());
    if (this.builder) this.drawLive();
  }

  private drawLive(): void {
    const ctx = this.ctx;
    if (!ctx || !this.builder) return;
    const style = styleOf(activeSlot());
    ctx.fillStyle = fillOf(style, this.surface.scheme());
    ctx.fill(outlineOf(this.builder.points, style.tool, style.width, false));
  }

  private toPage(event: PointerEvent): Vec {
    const camera = this.surface.cameraNow();
    return stripToPage(
      { x: event.clientX, y: event.clientY },
      this.strip,
      this.box,
      this.settings().magnification,
      camera.zoom,
    );
  }

  down(event: PointerEvent): void {
    if (this.timer) clearTimeout(this.timer);
    const style = styleOf(activeSlot());
    const camera = this.surface.cameraNow();
    this.pointerId = event.pointerId;
    this.builder = createStrokeBuilder({
      tool: style.tool,
      width: style.width,
      slot: style.slot,
      color: style.color,
      block: this.surface.layerFor(),
      newId: () => newId(),
      timeOrigin: Date.now() - performance.now(),
      ...penFeel(
        penKeyOf(event as PointerEvent & { persistentDeviceId?: number }),
        this.settings().magnification * camera.zoom,
      ),
    });
    this.sample(event);
  }

  private sample(event: PointerEvent): void {
    const at = this.toPage(event);
    const pen = event.pointerType === 'pen';
    this.builder?.push({
      x: at.x,
      y: at.y,
      time: event.timeStamp,
      pointerType: pen ? 'pen' : event.pointerType === 'touch' ? 'touch' : 'mouse',
      pressure: pen ? event.pressure : undefined,
      tiltX: pen ? event.tiltX : undefined,
      tiltY: pen ? event.tiltY : undefined,
    });
  }

  move(events: readonly PointerEvent[]): void {
    for (const event of events) if (event.pointerId === this.pointerId) this.sample(event);
    this.render();
  }

  async up(event: PointerEvent): Promise<void> {
    this.sample(event);
    const strokes = this.builder?.finish() ?? [];
    this.builder = null;
    this.pointerId = null;
    if (strokes.length === 0) return this.render();
    await this.surface.add(strokes);
    this.render();
    if (this.settings().auto) this.afterStroke(strokes);
  }

  cancel(): void {
    this.builder = null;
    this.pointerId = null;
    this.render();
  }

  /** The box moves on when the pen reached its right quarter, a moment after, so a dot or crossbar can come first. */
  private afterStroke(strokes: readonly InkStroke[]): void {
    const bounds: Bounds = strokes.map(strokeBounds).reduce((a, b) => ({
      minX: Math.min(a.minX, b.minX),
      minY: Math.min(a.minY, b.minY),
      maxX: Math.max(a.maxX, b.maxX),
      maxY: Math.max(a.maxY, b.maxY),
    }));
    if (!shouldAdvance(this.box, bounds)) return;
    this.timer = setTimeout(() => this.step(), ADVANCE_DELAY_MS);
  }

  /** Next: half a box to the right, or the next line at the margin. */
  step(): void {
    const move = advance(this.box, this.margins(), undefined);
    this.moveTo(move.box);
    if (move.wrapped) announce(t('ink.zoomBox.wrapped'));
  }

  lineBreak(): void {
    this.moveTo(newLine(this.box, this.margins()));
    announce(t('ink.zoomBox.newLineAnnounced'));
  }

  private moveTo(box: ZoomBox): void {
    this.box = box;
    // The page scrolls to keep the box in view, above the strip.
    const camera = this.surface.cameraNow();
    const { zoom, scrollX, scrollY, viewport } = camera;
    const strip = stripHeight(viewport.h);
    const view: Bounds = {
      minX: scrollX / zoom,
      minY: scrollY / zoom,
      maxX: (scrollX + viewport.w) / zoom,
      maxY: (scrollY + viewport.h - strip) / zoom,
    };
    const delta = revealDelta(box, view);
    if (delta.x !== 0 || delta.y !== 0) {
      this.host.viewport.get()?.viewport.scrollBy({ left: delta.x * zoom, top: delta.y * zoom, behavior: 'instant' });
    }
    this.render();
  }

  private readonly onKey = (event: KeyboardEvent) => {
    const key = KEYS[event.key];
    if (key) {
      event.preventDefault();
      event.stopPropagation();
      const line = this.surface.query({
        minX: -1e6,
        maxX: 1e6,
        minY: this.box.origin.y,
        maxY: this.box.origin.y + this.box.height,
      });
      const inkRight = line.length > 0 ? Math.max(...line.map((s) => strokeBounds(s).maxX)) : undefined;
      this.moveTo(moveBox(this.box, key, this.margins(), undefined, inkRight));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.lineBreak();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setPrefs({ zoomBox: false });
    }
  };

  contains(target: EventTarget | null): boolean {
    return target === this.canvas;
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.stops.forEach((stop) => stop());
    this.marker.remove();
    this.element.remove();
  }
}

/** Opens the strip when the person turns it on, and follows the page that is shown. */
export function installZoomBox(host: InkHost, surfaces: Store<InkSurface | null>): () => void {
  let view: ZoomBoxView | null = null;
  const sync = () => {
    const surface = surfaces.get();
    const want = isEnabled('ink.zoomBox') && inkPrefs.get().zoomBox && surface !== null && !surface.readOnly;
    if (
      view &&
      (!want || view.canvas.ownerDocument !== surface?.chrome.ownerDocument || !surface.chrome.contains(view.element))
    ) {
      view.destroy();
      view = null;
    }
    if (want && !view && surface) view = new ZoomBoxView(host, surface);
  };
  const stops = [surfaces.subscribe(sync), inkPrefs.subscribe(sync)];
  sync();
  const tool: InkPointerTool = {
    id: 'ink.zoomStrip',
    // Above the palm filter, so a finger or pen on the strip writes in it.
    priority: 108,
    accepts: (event) => view !== null && view.contains(event.target),
    down(event, ctx) {
      ctx.capture(event.pointerId);
      view?.down(event);
      return 'claim';
    },
    move(events) {
      view?.move(events);
      return 'claim';
    },
    up(event) {
      void view?.up(event);
    },
    cancel() {
      view?.cancel();
    },
  };
  const stopTool = host.registerPointerTool(tool);
  return () => {
    stopTool();
    stops.forEach((stop) => stop());
    view?.destroy();
    view = null;
  };
}
