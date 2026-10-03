// The touch tool: while a pen tool is active, every touch on the page goes through the palm filter (the input
// pipeline's public API), which decides whether it draws, navigates, or is a palm to ignore. Pen hover and contact
// feed the same filter, so a touch under the writing hand never draws. Navigation goes through the viewport's
// public API: scrolling the scroller and setting the zoom.
import { isEnabled } from '../../../app/flags';
import { newId } from '../../../editor/ids';
import { getSettings } from '../../../state/settings';
import type { CameraOp, InkPipeline, PipelineHost, PointerRecord, TouchInk } from '../input/pipeline';
import type { TouchStrokePhase } from '../input/pipeline';
import { createStrokeBuilder } from '../input/strokeBuilder';
import { applyHold, holdFor } from '../snap';
import type { Hold } from '../snap';
import type { InkHost, InkPointerTool } from './host';
import { snapToolsNow } from './snapTools';
import { activeSlot, drawState, styleOf, writesInk } from './state';
import type { InkSurface } from './surface';

type Palm = typeof import('./palm');

/** The palm filter's settings: the stored ink settings, with the writing hand and finger choice as Settings sets them. */
function palmSettings(palm: Palm) {
  const ink = getSettings().ink;
  return { ...palm.palmSettingsFromInk(ink), handedness: ink.handedness, fingerDraw: ink.touch.finger };
}

const PEN_EVENTS = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel'] as const;

/** Copies a pointer event into the pipeline's reused record. */
function fill(record: PointerRecord, event: PointerEvent, type: PointerRecord['type']): PointerRecord {
  record.type = type;
  record.id = event.pointerId;
  record.kind = event.pointerType === 'pen' ? 'pen' : event.pointerType === 'touch' ? 'touch' : 'mouse';
  record.t = event.timeStamp;
  record.x = event.clientX;
  record.y = event.clientY;
  record.w = event.width;
  record.h = event.height;
  record.p = event.pressure;
  record.tiltX = event.tiltX;
  record.tiltY = event.tiltY;
  record.buttons = event.buttons;
  return record;
}

export class TouchTool {
  readonly tool: InkPointerTool;
  private readonly record: PointerRecord = {
    ...{ type: 'down', id: 0, kind: 'touch', t: 0, x: 0, y: 0, w: 0, h: 0, p: 0 },
    ...{ tiltX: 0, tiltY: 0, buttons: 0, surface: 'page' },
  };
  private readonly snapshots = new Map<number, { left: number; top: number; zoom: number }>();
  private readonly shown = new Map<number, TouchInk>();
  /** What the snap tools hold each touch stroke to. */
  private readonly holds = new Map<number, Hold>();
  private pipeline: InkPipeline | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  // The palm filter is the largest part of ink input, so it loads in its own chunk, right after the ink view.
  private palm: Palm | null = null;
  /** Hears the two- and three-finger double taps. */
  onGesture: ((kind: 'undo' | 'redo') => void) | null = null;

  constructor(
    private readonly host: InkHost,
    private readonly surfaceOf: () => InkSurface | null,
  ) {
    void import('./palm').then((loaded) => (this.palm = loaded));
    this.tool = {
      id: 'ink.palm',
      priority: 100,
      accepts: (event) => this.accepts(event),
      down: (event, ctx) => {
        ctx.capture(event.pointerId);
        focusPage(host.viewport.get()?.viewport);
        this.ensure().handle(fill(this.record, event, 'down'));
        return 'claim';
      },
      move: (events) => {
        const pipeline = this.ensure();
        for (const event of events) pipeline.handle(fill(this.record, event, 'move'));
        return 'claim';
      },
      up: (event) => this.ensure().handle(fill(this.record, event, 'up')),
      cancel: () => this.pipeline?.system('blur', performance.now()),
    };
    for (const type of PEN_EVENTS) window.addEventListener(type, this.onPen, { capture: true, passive: true });
    window.addEventListener('blur', this.onBlur);
  }

  /** Settings changed: the next touch builds a filter with the new ones. */
  reset(): void {
    this.pipeline = null;
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  destroy(): void {
    for (const type of PEN_EVENTS) window.removeEventListener(type, this.onPen, { capture: true });
    window.removeEventListener('blur', this.onBlur);
    this.reset();
  }

  private accepts(event: PointerEvent): boolean {
    return event.pointerType === 'touch' && this.active();
  }

  /** A pen tool is active on an editable page, and the palm filter has loaded. */
  private active(): boolean {
    const surface = this.surfaceOf();
    if (!surface || surface.readOnly || !this.palm) return false;
    return writesInk(drawState.get().tool) && isEnabled('ink.core') && isEnabled('ink.palm');
  }

  /**
   * Pen hover and contact tell the palm filter a pen is near. The filter starts with the first pen event while a pen
   * tool is active, so a palm that lands while the pen is already down meets a filter that knows it.
   */
  private readonly onPen = (event: PointerEvent) => {
    if (event.pointerType !== 'pen') return;
    if (!this.pipeline && !this.active()) return;
    const type =
      event.type === 'pointerdown'
        ? 'down'
        : event.type === 'pointerup'
          ? 'up'
          : event.type === 'pointercancel'
            ? 'cancel'
            : 'move';
    this.ensure().handle(fill(this.record, event, type));
  };

  private readonly onBlur = () => this.pipeline?.system('blur', performance.now());

  private ensure(): InkPipeline {
    if (this.pipeline) return this.pipeline;
    const palm = this.palm!;
    const made = palm.createInkPipeline(this.pipelineHost(), palmSettings(palm), { platform: 'windows' });
    made.setInkToolActive(true);
    this.pipeline = made;
    this.tick = setInterval(() => {
      if (made.needsTick()) made.tick(performance.now());
    }, 100);
    return made;
  }

  private pipelineHost(): PipelineHost {
    return {
      penSample: () => undefined,
      touchBuilder: () => this.builder(),
      toPage: (r, out) => {
        const at = this.host.viewport.get()?.toWorld(r.x, r.y) ?? { x: 0, y: 0 };
        out.x = at.x;
        out.y = at.y;
        this.snap(r.id, r.type, out);
      },
      touchStroke: (id, phase, ink) => this.touchStroke(id, phase, ink),
      camera: (op, id, a, b, c) => this.camera(op, id, a, b, c),
      tap: () => undefined,
      contextMenu: () => undefined,
      // A silent gesture takes back one the filter delivered just before a pen arrived; neither shows feedback here.
      gesture: (kind, _silent) => this.onGesture?.(kind),
      touchPolicy: () => undefined,
    };
  }

  /** Holds a touch stroke to the ruler, protractor, or grid, the way the pen's strokes are. */
  private snap(id: number, type: PointerRecord['type'], out: { x: number; y: number }): void {
    const tools = snapToolsNow(this.host.viewport.get()?.camera().zoom ?? 1);
    if (type === 'up' || type === 'cancel') {
      const hold = this.holds.get(id);
      this.holds.delete(id);
      if (tools && hold) Object.assign(out, applyHold(tools, hold, out));
      return;
    }
    if (!tools) return;
    let hold = this.holds.get(id);
    if (!hold) {
      hold = holdFor(tools, out);
      this.holds.set(id, hold);
    }
    Object.assign(out, applyHold(tools, hold, out));
  }

  private builder() {
    const style = styleOf(activeSlot());
    return createStrokeBuilder({
      tool: style.tool,
      width: style.width,
      slot: style.slot,
      color: style.color,
      block: this.surfaceOf()?.layerFor() ?? '',
      newId: () => newId(),
      timeOrigin: Date.now() - performance.now(),
    });
  }

  /** Provisional touch ink draws on the live canvas only; a commit saves it, and an uncommit takes it back. */
  private touchStroke(id: number, phase: TouchStrokePhase, ink: TouchInk): void {
    const surface = this.surfaceOf();
    if (!surface) return;
    if (phase === 'show' || phase === 'point' || phase === 'hold') this.shown.set(id, ink);
    if (phase === 'retract') this.shown.delete(id);
    if (phase === 'commit') {
      this.shown.delete(id);
      if (ink.strokes) void surface.add(ink.strokes);
    }
    if (phase === 'uncommit' && ink.strokes) void surface.remove(ink.strokes.map((s) => s.id));
    surface.clearLive();
    const style = styleOf(activeSlot());
    for (const shown of this.shown.values()) surface.drawLive(shown.builder.points, style);
  }

  private camera(op: CameraOp, id: number, a: number, b: number, c: number): void {
    const viewport = this.host.viewport.get();
    if (!viewport) return;
    const scroller = viewport.viewport;
    if (op === 'snapshot') {
      this.snapshots.set(id, { left: scroller.scrollLeft, top: scroller.scrollTop, zoom: viewport.camera().zoom });
    } else if (op === 'panBy') scroller.scrollBy({ left: -a, top: -b, behavior: 'instant' });
    else if (op === 'zoomAt') viewport.setZoom(viewport.camera().zoom * c, { x: a, y: b });
    else if (op === 'revert') {
      const at = this.snapshots.get(id);
      if (!at) return;
      viewport.setZoom(at.zoom);
      scroller.scrollTo({ left: at.left, top: at.top, behavior: 'instant' });
    } else if (op === 'release') this.snapshots.delete(id);
  }
}

/** Drawing puts the keyboard on the page, so Ctrl+Z undoes the stroke just drawn, not the last thing typed elsewhere. */
export function focusPage(scroller: HTMLElement | undefined): void {
  const active = scroller?.ownerDocument.activeElement;
  if (scroller && !(active instanceof Node && scroller.contains(active))) scroller.focus({ preventScroll: true });
}
