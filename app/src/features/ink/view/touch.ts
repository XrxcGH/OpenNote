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
import { MIN_GLIDE_SPEED, glide } from '../input/touchNav';
import type { Hold } from '../snap';
import type { InkHost, InkPointerTool } from './host';
import { snapToolsNow } from './snapTools';
import { activeSlot, drawState, styleOf, writesInk } from './state';
import type { DrawTool } from './state';
import type { InkSurface } from './surface';

/** The tools the palm filter manages touch for: every pen tool, not only the ones that write ink. */
const penTool = (tool: DrawTool): boolean => tool !== 'select';

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
  /** Where each live contact is, for the tap and long press the filter allows. */
  private readonly at = new Map<number, { x: number; y: number }>();
  private glideFrame = 0;
  private stopTool: (() => void) | null = null;
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
        this.stopGlide();
        this.at.set(event.pointerId, { x: event.clientX, y: event.clientY });
        this.syncViewport();
        focusPage(host.viewport.get()?.viewport);
        this.ensure().handle(fill(this.record, event, 'down'));
        return 'claim';
      },
      move: (events) => {
        const pipeline = this.ensure();
        for (const event of events) {
          this.at.set(event.pointerId, { x: event.clientX, y: event.clientY });
          pipeline.handle(fill(this.record, event, 'move'));
        }
        return 'claim';
      },
      up: (event) => {
        this.at.set(event.pointerId, { x: event.clientX, y: event.clientY });
        this.ensure().handle(fill(this.record, event, 'up'));
        this.at.delete(event.pointerId);
      },
      // One contact the system cancels (a thumb at the edge, an OS palm verdict) ends alone, as a cancel; only the
      // router stopping, with no pointer to name, ends them all.
      cancel: (_ctx, event) => {
        if (event?.pointerType === 'touch') {
          this.ensure().handle(fill(this.record, event, 'cancel'));
          this.at.delete(event.pointerId);
        } else this.pipeline?.system('blur', performance.now());
      },
    };
    this.stopTool = drawState.subscribe(() => this.pipeline?.setInkToolActive(writesInk(drawState.get().tool)));
    for (const type of PEN_EVENTS) window.addEventListener(type, this.onPen, { capture: true, passive: true });
    window.addEventListener('blur', this.onBlur);
  }

  /** Settings changed: the live filter takes the new ones, so a contact in progress keeps its place. */
  reset(): void {
    if (this.pipeline && this.palm) this.pipeline.filter.configure(palmSettings(this.palm));
  }

  /** The page changed: strokes the filter holds commit now, to the page they were drawn on. */
  pageSwitch(): void {
    this.pipeline?.system('pageSwitch', performance.now());
    this.shown.clear();
    this.holds.clear();
    this.snapshots.clear();
    this.at.clear();
  }

  destroy(): void {
    this.stopTool?.();
    this.stopGlide();
    for (const type of PEN_EVENTS) window.removeEventListener(type, this.onPen, { capture: true });
    window.removeEventListener('blur', this.onBlur);
    this.pipeline = null;
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  private accepts(event: PointerEvent): boolean {
    return event.pointerType === 'touch' && this.active();
  }

  /** A pen tool is active on an editable page, and the palm filter has loaded. Every pen tool counts: a palm must not pan the page under the eraser either. */
  private active(): boolean {
    const surface = this.surfaceOf();
    if (!surface || surface.readOnly || !this.palm) return false;
    return penTool(drawState.get().tool) && isEnabled('ink.core') && isEnabled('ink.palm');
  }

  /**
   * Pen hover and contact tell the palm filter a pen is near. The filter starts with the first pen event while a pen
   * tool is active, so a palm that lands while the pen is already down meets a filter that knows it.
   */
  private readonly onPen = (event: PointerEvent) => {
    if (event.pointerType !== 'pen') return;
    if (event.type === 'pointerdown') this.stopGlide();
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
    made.setInkToolActive(writesInk(drawState.get().tool));
    this.pipeline = made;
    this.syncViewport();
    this.tick = setInterval(() => {
      if (made.needsTick()) made.tick(performance.now());
    }, 100);
    return made;
  }

  /** Tells the filter the page's size, for the edge-grip and edge-start rules. */
  private syncViewport(): void {
    const el = this.host.viewport.get()?.viewport;
    if (el && this.pipeline) this.pipeline.filter.setViewport(el.clientWidth, el.clientHeight);
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
      tap: (id, allowed) => this.tapAt(id, allowed),
      contextMenu: (id, allowed) => this.pressAt(id, allowed),
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

  /** The element under a contact, ignoring the ink layers drawn over the page. */
  private under(id: number): { el: Element; x: number; y: number } | null {
    const at = this.at.get(id);
    if (!at) return null;
    const el = document.elementsFromPoint(at.x, at.y).find((e) => !(e instanceof HTMLCanvasElement));
    return el ? { el, x: at.x, y: at.y } : null;
  }

  /** A tap the filter allows does what a tap does: clicks a checkbox or link, or puts the caret where it landed. */
  private tapAt(id: number, allowed: boolean): void {
    const hit = allowed ? this.under(id) : null;
    if (!hit) return;
    const { el, x, y } = hit;
    const editable = el.closest('[contenteditable="true"]');
    if (editable instanceof HTMLElement) {
      editable.focus({ preventScroll: true });
      const range = document.caretRangeFromPoint?.(x, y);
      const selection = window.getSelection();
      if (range && selection && editable.contains(range.startContainer)) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    const target = el.closest('a, button, input, label, summary, [role="button"], [role="checkbox"], [role="link"]');
    if (target instanceof HTMLElement) target.click();
  }

  /** A long press the filter allows opens the context menu at the contact. */
  private pressAt(id: number, allowed: boolean): void {
    const hit = allowed ? this.under(id) : null;
    if (!hit) return;
    hit.el.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: hit.x, clientY: hit.y }),
    );
  }

  private stopGlide(): void {
    if (this.glideFrame) cancelAnimationFrame(this.glideFrame);
    this.glideFrame = 0;
  }

  /** A flick glides on, slowing smoothly, until it is slow, the pen or a finger lands, or the camera is held. */
  private fling(vx: number, vy: number): void {
    this.stopGlide();
    const viewport = this.host.viewport.get();
    if (!viewport || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let vX = vx;
    let vY = vy;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(now - last, 50);
      last = now;
      const x = glide(vX, dt);
      const y = glide(vY, dt);
      viewport.viewport.scrollBy({ left: -x.distance, top: -y.distance, behavior: 'instant' });
      vX = x.speed;
      vY = y.speed;
      this.glideFrame = Math.hypot(vX, vY) < MIN_GLIDE_SPEED ? 0 : requestAnimationFrame(step);
    };
    this.glideFrame = requestAnimationFrame(step);
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
    else if (op === 'fling') {
      this.snapshots.delete(id);
      this.fling(a, b);
    }
  }
}

/** Drawing puts the keyboard on the page, so Ctrl+Z undoes the stroke just drawn, not the last thing typed elsewhere. */
export function focusPage(scroller: HTMLElement | undefined): void {
  const active = scroller?.ownerDocument.activeElement;
  if (scroller && !(active instanceof Node && scroller.contains(active))) scroller.focus({ preventScroll: true });
}
