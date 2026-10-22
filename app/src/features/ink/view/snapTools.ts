// The snap tools on the page: a ruler, a protractor, and a grid, drawn in the page's chrome layer over the ink. Touch and
// pen both move and turn them (a drag on the body moves, a drag on the round handle turns), and the keyboard does the
// same: arrow keys move, [ and ] turn. The pen tool asks `snapToolsNow` for what a stroke should be held to.
// With the geometry tools on (flag ink.geometry), the ruler is a measuring ruler: it shows centimeters or inches by
// the units setting, and reads out the length of a line drawn along it. The measure and the compass (measureTool.ts,
// compass.ts) take the pen while one of them is chosen; `snapMark` puts their points where the snap tools say.
import { isEnabled } from '../../../app/flags';
import { createStore } from '../../../state/store';
import type { Store } from '../../../state/store';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import {
  ANGLE_STEP_DEGREES,
  DEFAULT_PROTRACTOR,
  DEFAULT_RULER,
  gridSize,
  nearRulerEdge,
  onRulerEdge,
  protractorAngle,
  resolveUnits,
  roundedLength,
  rulerTicks,
  snapPoint,
  snapToGrid,
  unitStep,
} from '../snap';
import type { LengthUnits, Protractor, Ruler, SnapTools } from '../snap';
import type { Vec } from '../geometry/types';
import type { InkHost, InkPointerTool } from './host';
import { hasPaperLines, paperNow, paperSnapNow } from './paperSnap';
import { inkPrefs, setPrefs } from './prefs';
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

/**
 * True when the Draw tab's own grid is in use: snap to grid is on and the page's paper has no lines. On ruled, grid,
 * or dot paper, shapes snap to the paper's lines instead (paperSnap.ts), and freehand ink is never snapped.
 */
export function overlayGridOn(): boolean {
  return inkPrefs.get().gridSnap && !hasPaperLines();
}

/** What strokes are held to now, or null when no snap tool is on. */
export function snapToolsNow(zoom: number): SnapTools | null {
  if (!isEnabled('ink.snapTools')) return null;
  const prefs = inkPrefs.get();
  const gridOn = overlayGridOn();
  if (!prefs.ruler && !prefs.protractor && !gridOn) return null;
  const geometry = snapGeometry.get();
  return {
    ruler: prefs.ruler ? geometry.ruler : null,
    protractor: prefs.protractor ? geometry.protractor : null,
    grid: gridOn ? gridSize(prefs.gridMm) : 0,
    reach: REACH_PX / zoom,
  };
}

/** The units the ruler, the measure, and the compass show now. */
export function rulerUnitsNow(): LengthUnits {
  return resolveUnits(inkPrefs.get().rulerUnits, globalThis.navigator?.language ?? 'en-US');
}

/** A length in page units as the ruler reads it, such as "4.3 cm" or "1.75 in". */
export function formatLength(pageUnits: number, units: LengthUnits = rulerUnitsNow()): string {
  const { value, unit } = roundedLength(pageUnits, units);
  const text = unit === 'cm' ? value.toFixed(1) : String(Number(value.toFixed(4)));
  return t(unit === 'cm' ? 'ink.measure.cm' : 'ink.measure.in', { value: text });
}

/** True when the measuring ruler, the measure, and the compass are available. */
export const geometryOn = (): boolean => isEnabled('ink.snapTools') && isEnabled('ink.geometry');

/**
 * A point the measure or the compass marks, put where the snap tools say: on the ruler's edge when it is near it, else
 * on the paper's lines or the Draw tab's grid when snapping is on. Alt keeps it off the lines, as it does for shapes.
 */
export function snapMark(p: Vec, zoom: number, alt = false): Vec {
  const prefs = inkPrefs.get();
  if (isEnabled('ink.snapTools') && prefs.ruler) {
    const ruler = snapGeometry.get().ruler;
    const edge = nearRulerEdge(ruler, p, REACH_PX / zoom);
    if (edge !== null) return onRulerEdge(ruler, edge, p);
  }
  if (alt) return p;
  const paper = paperSnapNow(zoom);
  if (paper) return snapPoint(paper, p).point;
  if (isEnabled('ink.snapTools') && overlayGridOn()) return snapToGrid(p, gridSize(prefs.gridMm));
  return p;
}

/**
 * A compass's radius in whole spacings of the paper's lines, or of the Draw tab's grid, when snapping is on, as boxes
 * and ellipses keep whole spacings. Alt, or no lines and no grid, leaves it as dragged.
 */
export function snapRadius(radius: number, zoom: number, alt = false): number {
  if (alt) return radius;
  const paper = paperSnapNow(zoom);
  const step = paper
    ? paper.lattice.step
    : isEnabled('ink.snapTools') && overlayGridOn()
      ? gridSize(inkPrefs.get().gridMm)
      : 0;
  return step > 0 ? Math.max(step, Math.round(radius / step) * step) : radius;
}

/** Which of the measure and the compass has the pen, if either. */
export type GeometryTool = 'none' | 'measure' | 'compass';
export const geometryTool = createStore<GeometryTool>('none', 'ink geometry tool');

/** Chooses the measure or the compass, or puts it away when it is already chosen. */
export function toggleGeometryTool(which: Exclude<GeometryTool, 'none'>): void {
  const next = geometryTool.get() === which ? 'none' : which;
  geometryTool.set(next);
  const label = t(which === 'measure' ? 'ink.measure.title' : 'ink.compass.title');
  announce(t(next === 'none' ? 'ink.snap.off' : 'ink.snap.on', { tool: label }));
}

/** Chooses the ruler's units and says so. */
export function setRulerUnits(choice: 'auto' | LengthUnits): void {
  setPrefs({ rulerUnits: choice });
  const name = t(rulerUnitsNow() === 'imperial' ? 'ink.snap.unitsNameImperial' : 'ink.snap.unitsNameMetric');
  announce(t('ink.snap.unitsChosen', { units: name }));
}

const SVG = 'http://www.w3.org/2000/svg';

/** The ruler's tick marks and numbers as SVG, in page units across its length from the left end. */
function tickMarks(doc: Document, ruler: Ruler, units: LengthUnits): SVGSVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${ruler.length} ${ruler.width}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.dataset.inkTicks = units;
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'hidden' });
  const mm = unitStep('metric');
  const long = { minor: 2 * mm, mid: 3.4 * mm, major: 5 * mm };
  const ticks = rulerTicks(ruler.length, units);
  // Both long edges carry ticks, so a line drawn along either one can be read against them.
  let path = '';
  for (const tick of ticks) {
    const h = long[tick.size];
    path += `M${tick.at} 0V${h}M${tick.at} ${ruler.width}V${ruler.width - h}`;
  }
  const lines = doc.createElementNS(SVG, 'path');
  lines.setAttribute('d', path);
  lines.setAttribute('stroke', 'currentColor');
  lines.setAttribute('stroke-width', '1');
  lines.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(lines);
  const label = (x: number, text: string, anchor: 'middle' | 'start', size: number) => {
    const node = doc.createElementNS(SVG, 'text');
    node.setAttribute('x', String(x));
    node.setAttribute('y', String(long.major + 2.8 * mm));
    node.setAttribute('text-anchor', anchor);
    node.setAttribute('font-size', String(size * mm));
    node.setAttribute('fill', 'currentColor');
    node.textContent = text;
    svg.append(node);
  };
  for (const tick of ticks) if (tick.label && tick.at > 0) label(tick.at, tick.label, 'middle', 2.6);
  label(1.2 * mm, units === 'imperial' ? 'in' : 'cm', 'start', 2.2);
  return svg;
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
  readonly readout: HTMLOutputElement;
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
  const readout = doc.createElement('output');
  // The protractor's angle is read out as it is set. The ruler's length changes with every sample of a line, so it is
  // shown and not spoken; the measure tool speaks its result once.
  readout.setAttribute('aria-live', which === 'protractor' ? 'polite' : 'off');
  readout.dataset.inkReadout = which;
  Object.assign(readout.style, {
    position: 'absolute',
    left: '50%',
    // On the ruler, below the numbers and clear of the long ticks.
    ...(which === 'protractor'
      ? { bottom: '4px', transform: 'translateX(-50%)' }
      : { top: '66%', transform: 'translate(-50%, -50%)' }),
    color: 'var(--color-text-primary)',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  });
  element.append(readout);
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
    this.stops.push(
      inkPrefs.subscribe(() => this.place()),
      paperNow.subscribe(() => this.place()),
    );
    this.place();
  }

  widgetOf(target: EventTarget | null): Widget | null {
    if (!(target instanceof Element)) return null;
    for (const widget of [this.ruler, this.protractor]) if (widget.element.contains(target)) return widget;
    return null;
  }

  readAngle(deg: number): void {
    this.protractor.readout.textContent = t('ink.snap.angle', { degrees: Math.round(deg) });
  }

  readLength(text: string): void {
    this.ruler.readout.textContent = text;
  }

  /** The tick marks the ruler shows now, made again only when its length or units change. */
  private ticks: SVGSVGElement | null = null;
  private placeTicks(ruler: Ruler, show: boolean): void {
    if (!show) {
      this.ticks?.remove();
      this.ticks = null;
      return;
    }
    const units = rulerUnitsNow();
    const key = `${units}:${ruler.length}:${ruler.width}`;
    if (this.ticks?.dataset.inkKey === key) return;
    this.ticks?.remove();
    this.ticks = tickMarks(this.surface.chrome.ownerDocument, ruler, units);
    this.ticks.dataset.inkKey = key;
    this.ruler.element.prepend(this.ticks);
    const name = t(units === 'imperial' ? 'ink.snap.unitsNameImperial' : 'ink.snap.unitsNameMetric');
    this.ruler.element.setAttribute(
      'aria-label',
      `${t('ink.snap.rulerLabel')} ${t('ink.snap.ticks', { units: name })}`,
    );
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
      display: on && overlayGridOn() ? '' : 'none',
      backgroundImage: 'radial-gradient(circle, var(--color-text-secondary) 1px, transparent 1.5px)',
      backgroundSize: `${size}px ${size}px`,
      backgroundPosition: `${-scrollX}px ${-scrollY}px`,
      opacity: '0.35',
    });

    const rulerEl = this.ruler.element;
    const w = ruler.length * zoom;
    const h = ruler.width * zoom;
    const measuring = on && geometryOn();
    this.placeTicks(ruler, measuring && prefs.ruler);
    this.ruler.readout.style.display = measuring ? '' : 'none';
    Object.assign(rulerEl.style, {
      display: on && prefs.ruler ? '' : 'none',
      width: `${w}px`,
      height: `${h}px`,
      transform: placement(ruler.cx * zoom - scrollX, ruler.cy * zoom - scrollY, ruler.angle, w / 2, h / 2),
      // The measuring ruler draws its own ticks in centimeters or inches; the plain one shows millimeters.
      backgroundImage: measuring
        ? 'none'
        : [
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
    // The measuring ruler moves a millimeter or a sixteenth of an inch at a time, so it can be set against a mark.
    const step = geometryOn() ? unitStep(rulerUnitsNow()) : MOVE_STEP;
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
      ? { ...part, cx: part.cx + arrow[0] * step * fast, cy: part.cy + arrow[1] * step * fast }
      : { ...part, angle: part.angle + turn * TURN_STEP * (event.shiftKey ? ANGLE_STEP_DEGREES : 1) };
    snapGeometry.set({ ...g, [widget.which]: moved });
  };

  destroy(): void {
    this.stops.forEach((stop) => stop());
    this.ticks?.remove();
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

/** Shows the length of a line drawn along the ruler's edge, from where it began, in the ruler's readout. */
export function showRulerLength(from: Vec, to: Vec): void {
  if (!geometryOn()) return;
  shown?.readLength(t('ink.measure.along', { length: formatLength(Math.hypot(to.x - from.x, to.y - from.y)) }));
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
      // One widget drag at a time: a second contact, such as the heel of the hand, is held but moves nothing.
      if (layer.drag) return 'claim';
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
      const last = events.filter((one) => one.pointerId === drag?.pointerId).at(-1);
      if (!layer || !drag || !last) return 'claim';
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
    up(event) {
      if (!layer?.drag || layer.drag.pointerId !== event.pointerId) return;
      layer.drag = null;
      announce(t('ink.snap.placed'));
    },
    cancel(_ctx, event) {
      if (layer?.drag && (!event || event.pointerId === layer.drag.pointerId)) layer.drag = null;
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
