// The snap tools on the page: a ruler, a protractor, and a grid, drawn in the page's chrome layer over the ink. Touch and
// pen both move and turn them (a drag on the body moves, a drag on the round handle turns), and the keyboard does the
// same: arrow keys move, [ and ] turn. The pen tool asks `snapToolsNow` for what a stroke should be held to.
import { isEnabled } from '../../../app/flags';
import { createStore } from '../../../state/store';
import type { Store } from '../../../state/store';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { DEFAULT_PROTRACTOR, DEFAULT_RULER, gridSize, protractorAngle, ANGLE_STEP_DEGREES } from '../snap';
import type { Protractor, Ruler, SnapTools } from '../snap';
import type { InkHost, InkPointerTool } from './host';
import { inkPrefs } from './prefs';
import type { InkSurface } from './surface';

interface Geometry {
  readonly ruler: Ruler;
  readonly protractor: Protractor;
}

export const snapGeometry = createStore<Geometry>(
  { ruler: DEFAULT_RULER, protractor: DEFAULT_PROTRACTOR },
  'ink snap geometry',
);

/** How near a stroke must start to an edge or the center, in screen pixels. */
const REACH_PX = 14;
const MOVE_STEP = 4;
const TURN_STEP = Math.PI / 180;

/** What strokes are held to now, or null when no snap tool is on. */
export function snapToolsNow(zoom: number): SnapTools | null {
  if (!isEnabled('ink.snapTools')) return null;
  const prefs = inkPrefs.get();
  if (!prefs.ruler && !prefs.protractor && !prefs.gridSnap) return null;
  const geometry = snapGeometry.get();
  return {
    ruler: prefs.ruler ? geometry.ruler : null,
    protractor: prefs.protractor ? geometry.protractor : null,
    grid: prefs.gridSnap ? gridSize(prefs.gridMm) : 0,
    reach: REACH_PX / zoom,
  };
}

type Which = 'ruler' | 'protractor';

/** A widget moved to a place on the screen, turned about it, with its own anchor point `(ax, ay)` on that place. */
function placement(x: number, y: number, angle: number, ax: number, ay: number): string {
  return `translate(${x}px, ${y}px) rotate(${angle}rad) translate(${-ax}px, ${-ay}px)`;
}

interface Widget {
  readonly which: Which;
  readonly element: HTMLDivElement;
  readonly handle: HTMLButtonElement;
  readonly readout: HTMLOutputElement | null;
}

interface Drag {
  readonly which: Which;
  readonly mode: 'move' | 'turn';
  readonly start: { x: number; y: number };
  readonly from: Geometry;
  readonly pointerId: number;
}

function make(doc: Document, which: Which): Widget {
  const element = doc.createElement('div');
  element.dataset.inkWidget = which;
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', t(which === 'ruler' ? 'ink.snap.rulerLabel' : 'ink.snap.protractorLabel'));
  element.tabIndex = 0;
  Object.assign(element.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    transformOrigin: '0 0',
    pointerEvents: 'auto',
    cursor: 'move',
    border: '1px solid var(--color-border-strong, var(--color-border-subtle))',
    background: 'color-mix(in srgb, var(--color-surface-app) 78%, transparent)',
    color: 'var(--color-text-secondary)',
    touchAction: 'none',
    boxSizing: 'border-box',
  });
  const handle = doc.createElement('button');
  handle.type = 'button';
  handle.dataset.inkTurn = '';
  handle.setAttribute('aria-label', t('ink.snap.turn'));
  Object.assign(handle.style, {
    position: 'absolute',
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: '1px solid var(--color-accent-primary)',
    background: 'var(--color-surface-page)',
    cursor: 'grab',
    touchAction: 'none',
  });
  element.append(handle);
  let readout: HTMLOutputElement | null = null;
  if (which === 'protractor') {
    readout = doc.createElement('output');
    readout.setAttribute('aria-live', 'polite');
    Object.assign(readout.style, { position: 'absolute', left: '50%', bottom: '4px', transform: 'translateX(-50%)' });
    element.append(readout);
  }
  return { which, element, handle, readout };
}

/** The ruler and protractor widgets and the grid for one surface. */
class SnapLayer {
  private readonly ruler: Widget;
  private readonly protractor: Widget;
  private readonly grid: HTMLDivElement;
  private readonly stops: (() => void)[] = [];
  drag: Drag | null = null;

  constructor(private readonly surface: InkSurface) {
    const doc = surface.chrome.ownerDocument;
    this.ruler = make(doc, 'ruler');
    this.protractor = make(doc, 'protractor');
    this.grid = doc.createElement('div');
    this.grid.dataset.inkGrid = '';
    this.grid.setAttribute('aria-hidden', 'true');
    Object.assign(this.grid.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    surface.chrome.prepend(this.grid);
    surface.chrome.append(this.ruler.element, this.protractor.element);
    for (const widget of [this.ruler, this.protractor]) widget.element.addEventListener('keydown', this.onKey);
    this.stops.push(
      surface.onChange(() => this.place()),
      snapGeometry.subscribe(() => this.place()),
    );
    this.stops.push(inkPrefs.subscribe(() => this.place()));
    this.place();
  }

  widgetOf(target: EventTarget | null): Widget | null {
    if (!(target instanceof Element)) return null;
    for (const widget of [this.ruler, this.protractor]) if (widget.element.contains(target)) return widget;
    return null;
  }

  readAngle(deg: number): void {
    if (this.protractor.readout)
      this.protractor.readout.textContent = t('ink.snap.angle', { degrees: Math.round(deg) });
  }

  place(): void {
    const { zoom, scrollX, scrollY } = this.surface.cameraNow();
    const prefs = inkPrefs.get();
    const on = isEnabled('ink.snapTools');
    const { ruler, protractor } = snapGeometry.get();
    const mm = gridSize(1) * zoom;

    // The grid: dots at every crossing, in the page's own place.
    const size = gridSize(prefs.gridMm) * zoom;
    Object.assign(this.grid.style, {
      display: on && prefs.gridSnap ? '' : 'none',
      backgroundImage: 'radial-gradient(circle, var(--color-text-secondary) 1px, transparent 1.5px)',
      backgroundSize: `${size}px ${size}px`,
      backgroundPosition: `${-scrollX}px ${-scrollY}px`,
      opacity: '0.35',
    });

    const rulerEl = this.ruler.element;
    const w = ruler.length * zoom;
    const h = ruler.width * zoom;
    Object.assign(rulerEl.style, {
      display: on && prefs.ruler ? '' : 'none',
      width: `${w}px`,
      height: `${h}px`,
      transform: placement(ruler.cx * zoom - scrollX, ruler.cy * zoom - scrollY, ruler.angle, w / 2, h / 2),
      backgroundImage: [
        'linear-gradient(90deg, currentColor 1px, transparent 1px)',
        'linear-gradient(90deg, currentColor 1px, transparent 1px)',
      ].join(','),
      backgroundSize: `${mm}px 7px, ${mm * 10}px 14px`,
      backgroundRepeat: 'repeat-x',
      backgroundPosition: `${w % (mm * 10)}px 0, ${w % (mm * 10)}px 0`,
      borderRadius: 'var(--radius-sm)',
    });
    Object.assign(this.ruler.handle.style, { right: '-34px', top: `${h / 2 - 14}px` });

    const pEl = this.protractor.element;
    const pw = protractor.radius * 2 * zoom;
    const ph = protractor.radius * zoom;
    Object.assign(pEl.style, {
      display: on && prefs.protractor ? '' : 'none',
      width: `${pw}px`,
      height: `${ph}px`,
      transform: placement(
        protractor.cx * zoom - scrollX,
        protractor.cy * zoom - scrollY,
        protractor.angle,
        pw / 2,
        ph,
      ),
      borderRadius: `${pw}px ${pw}px 0 0`,
      backgroundImage: `repeating-conic-gradient(from 270deg at 50% 100%, currentColor 0 0.4deg, transparent 0.4deg 10deg)`,
      backgroundSize: '100% 100%',
      maskImage: 'none',
    });
    Object.assign(this.protractor.handle.style, { right: '-34px', bottom: '-14px' });
  }

  private readonly onKey = (event: KeyboardEvent) => {
    const widget = this.widgetOf(event.currentTarget);
    if (!widget) return;
    const fast = event.shiftKey ? 10 : 1;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const arrow = arrows[event.key];
    const turn = event.key === '[' ? -1 : event.key === ']' ? 1 : 0;
    if (!arrow && !turn) return;
    event.preventDefault();
    event.stopPropagation();
    const g = snapGeometry.get();
    const part = g[widget.which];
    const moved = arrow
      ? { ...part, cx: part.cx + arrow[0] * MOVE_STEP * fast, cy: part.cy + arrow[1] * MOVE_STEP * fast }
      : { ...part, angle: part.angle + turn * TURN_STEP * (event.shiftKey ? ANGLE_STEP_DEGREES : 1) };
    snapGeometry.set({ ...g, [widget.which]: moved });
  };

  destroy(): void {
    this.stops.forEach((stop) => stop());
    this.ruler.element.remove();
    this.protractor.element.remove();
    this.grid.remove();
  }
}

let shown: SnapLayer | null = null;

/** Shows the angle a protractor-held line makes, in the readout at the protractor's center. */
export function showProtractorAngle(origin: { x: number; y: number }, to: { x: number; y: number }): void {
  shown?.readAngle(protractorAngle(snapGeometry.get().protractor, origin, to));
}

/** The pointer tool for the widgets: it claims a press on one, then moves or turns it as the pointer goes. */
export function installSnapTools(host: InkHost, surfaces: Store<InkSurface | null>): () => void {
  let layer: SnapLayer | null = null;
  const sync = () => {
    layer?.destroy();
    const surface = surfaces.get();
    layer = surface ? new SnapLayer(surface) : null;
    shown = layer;
  };
  const stopSurface = surfaces.subscribe(sync);
  sync();

  const tool: InkPointerTool = {
    id: 'ink.snapWidgets',
    // Above the palm filter (100), so a finger on a ruler moves the ruler and never draws.
    priority: 105,
    accepts: (event) => layer !== null && layer.widgetOf(event.target) !== null,
    down(event, ctx) {
      const widget = layer?.widgetOf(event.target);
      if (!layer || !widget) return 'watch';
      ctx.capture(event.pointerId);
      layer.drag = {
        which: widget.which,
        mode: event.target === widget.handle ? 'turn' : 'move',
        start: ctx.toWorld(event.clientX, event.clientY),
        from: snapGeometry.get(),
        pointerId: event.pointerId,
      };
      widget.element.focus({ preventScroll: true });
      return 'claim';
    },
    move(events, ctx) {
      const drag = layer?.drag;
      const last = events.at(-1);
      if (!layer || !drag || !last || last.pointerId !== drag.pointerId) return 'claim';
      const at = ctx.toWorld(last.clientX, last.clientY);
      const part = drag.from[drag.which];
      if (drag.mode === 'move') {
        snapGeometry.set({
          ...drag.from,
          [drag.which]: { ...part, cx: part.cx + at.x - drag.start.x, cy: part.cy + at.y - drag.start.y },
        });
      } else {
        const turned =
          Math.atan2(at.y - part.cy, at.x - part.cx) - Math.atan2(drag.start.y - part.cy, drag.start.x - part.cx);
        snapGeometry.set({ ...drag.from, [drag.which]: { ...part, angle: part.angle + turned } });
      }
      return 'claim';
    },
    up() {
      if (layer) layer.drag = null;
      announce(t('ink.snap.placed'));
    },
    cancel() {
      if (layer) layer.drag = null;
    },
  };
  const stopTool = host.registerPointerTool(tool);
  return () => {
    stopTool();
    stopSurface();
    layer?.destroy();
    layer = null;
    shown = null;
  };
}
