// The touch tool: while a pen tool is active, every touch on the page goes through the palm filter (the input
// pipeline's public API), which decides whether it draws, navigates, or is a palm to ignore. Pen hover and contact
// feed the same filter, so a touch under the writing hand never draws. Navigation goes through the viewport's
// public API: scrolling the scroller and setting the zoom.
import { isEnabled } from '../../../app/flags';
import { newId } from '../../../editor/ids';
import { getSettings } from '../../../state/settings';
import type { CameraOp, InkPipeline, PipelineHost, PointerRecord, TouchInk } from '../input/pipeline';
import type { TouchStrokePhase } from '../input/pipeline';
import type { LearnedState } from '../input/palm/index';
import { createStrokeBuilder } from '../input/strokeBuilder';
import { applyHold, holdFor } from '../snap';
import { MIN_GLIDE_SPEED, glide } from '../input/touchNav';
import type { Hold } from '../snap';
import type { InkHost, InkPointerTool } from './host';
import { showRulerLength, snapToolsNow } from './snapTools';
import { activeSlot, drawState, styleOf, writesInk } from './state';
import type { DrawTool } from './state';
import type { InkSurface } from './surface';
import { isEditing, objectAt, onObjectHandle, selectObject, TAP_SLOP_PX } from './objectTaps';

/** The tools the palm filter manages touch for: every pen tool, not only the ones that write ink. */
const penTool = (tool: DrawTool): boolean => tool !== 'select';

type Palm = typeof import('./palm');

/** The palm filter's settings: the stored ink settings, with the writing hand and finger choice as Settings sets them. */
function palmSettings(palm: Palm) {
  const ink = getSettings().ink;
  return { ...palm.palmSettingsFromInk(ink), handedness: ink.handedness, fingerDraw: ink.touch.finger };
}

/** A touch this wide (CSS px, about 7 mm) while a pen is in use is a palm, not a finger. */
const PALM_PX = 28;

/** True for a contact as wide as a palm. */
export const palmSized = (event: PointerEvent): boolean => Math.max(event.width, event.height) >= PALM_PX;

/** What a tap that selects or edits must not take from: the controls a tap presses. */
const CONTROLS = 'a, button, input, label, summary, [role="button"], [role="checkbox"], [role="link"]';

/** A lifted contact is forgotten this long (ms) after it lifted, once its ink has long been committed or taken back. */
const CONTACT_KEEP_MS = 30_000;

/** When and where a contact began, how far it went (CSS px), and when it lifted, for a finger's held tap. */
interface Contact {
  t0: number;
  t1: number;
  x0: number;
  y0: number;
  travel: number;
}
/** How long before a palm-sized touch landed the pen may have been active for its click to be dropped. */
const PEN_RECENT_MS = 1500;

/** What a palm must not press while the pen is in use. */
const PRESSABLE =
  'button, a[href], [role=button], [role=menuitem], [role=tab], [role=option], [role=switch], [role=checkbox], [role=menuitemradio]';

const PEN_EVENTS = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel'] as const;

/**
 * What the palm filter learned on this device, the pen above all, kept across launches. Until a pen is seen every
 * finger draws, so without it each launch began with a finger tap leaving a dot until the pen came near.
 */
const LEARNED_KEY = 'opennote.ink.palmLearned';

function storedLearned(): LearnedState | undefined {
  try {
    const raw = localStorage.getItem(LEARNED_KEY);
    // The filter sanitizes what it is given, so a damaged value only loses what was learned.
    return raw ? (JSON.parse(raw) as LearnedState) : undefined;
  } catch {
    return undefined;
  }
}

function storeLearned(learned: LearnedState): void {
  try {
    localStorage.setItem(LEARNED_KEY, JSON.stringify(learned));
  } catch {
    // What was learned is learned again next time.
  }
}

/**
 * The selection frame's bar is a control outside the page to the palm filter: a finger's tap presses its button even
 * while fingers draw, where it would otherwise leave a dot, and a palm on it presses nothing.
 */
const FRAME_BAR = '[data-ink-selection-bar]';

/** Copies a pointer event into the pipeline's reused record. */
function fill(record: PointerRecord, event: PointerEvent, type: PointerRecord['type']): PointerRecord {
  record.type = type;
  // Only a landing reads the surface.
  record.surface =
    type === 'down' && event.target instanceof Element && event.target.closest(FRAME_BAR) ? 'chrome' : 'page';
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

/** Focuses the editable text under a tap and puts the caret where the tap landed. */
function placeCaret(el: Element, x: number, y: number): void {
  const editable = el.closest('[contenteditable="true"]');
  if (!(editable instanceof HTMLElement)) return;
  editable.focus({ preventScroll: true });
  const range = document.caretRangeFromPoint?.(x, y);
  const selection = window.getSelection();
  if (range && selection && editable.contains(range.startContainer)) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
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
  /** Where each touch line held to the ruler began, for the ruler's length readout. */
  private readonly rulerFrom = new Map<number, { x: number; y: number }>();
  /** Where each live contact is, for the tap and long press the filter allows. */
  private readonly at = new Map<number, { x: number; y: number }>();
  /** Each contact from its landing until its ink commits or is taken back. */
  private readonly contacts = new Map<number, Contact>();
  /** Touch ink that selected a text box instead of being added, so taking it back removes nothing. */
  private readonly swallowed = new Set<number>();
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
        const t = event.timeStamp;
        for (const [id, old] of this.contacts) {
          if (!this.at.has(id) && t - old.t1 > CONTACT_KEEP_MS) this.contacts.delete(id);
        }
        this.contacts.set(event.pointerId, { t0: t, t1: t, x0: event.clientX, y0: event.clientY, travel: 0 });
        this.syncViewport();
        focusPage(host.viewport.get()?.viewport);
        this.ensure().handle(fill(this.record, event, 'down'));
        return 'claim';
      },
      move: (events) => {
        const pipeline = this.ensure();
        for (const event of events) {
          this.at.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const contact = this.contacts.get(event.pointerId);
          if (contact)
            contact.travel = Math.max(
              contact.travel,
              Math.hypot(event.clientX - contact.x0, event.clientY - contact.y0),
            );
          pipeline.handle(fill(this.record, event, 'move'));
        }
        return 'claim';
      },
      up: (event) => {
        this.at.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const contact = this.contacts.get(event.pointerId);
        if (contact) contact.t1 = event.timeStamp;
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
    // A resize, rotation, or zoom moves the edges while the pipeline lives.
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pointerdown', this.onTouchDown, { capture: true, passive: true });
    window.addEventListener('pointerup', this.onTouchEnd, { capture: true, passive: true });
    window.addEventListener('pointercancel', this.onTouchEnd, { capture: true, passive: true });
    window.addEventListener('pointerdown', this.onPalmPress, true);
    window.addEventListener('pointerup', this.onPalmPress, true);
    window.addEventListener('click', this.onClick, true);
  }

  /** Settings changed: the live filter takes the new ones, so a contact in progress keeps its place. */
  reset(): void {
    if (this.pipeline && this.palm) this.pipeline.filter.configure(palmSettings(this.palm));
  }

  /** The page changed: strokes the filter holds commit now, to the page they were drawn on. */
  pageSwitch(): void {
    // Forgotten first, so a still tap the switch commits is ink on its page, not a tap on a box of the next one.
    this.contacts.clear();
    this.pipeline?.system('pageSwitch', performance.now());
    this.shown.clear();
    this.holds.clear();
    this.snapshots.clear();
    this.at.clear();
    this.swallowed.clear();
  }

  destroy(): void {
    this.stopTool?.();
    this.stopGlide();
    for (const type of PEN_EVENTS) window.removeEventListener(type, this.onPen, { capture: true });
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    // The hand's shape and the stylus tip, learned while the page was open, are kept with the pen.
    if (this.pipeline?.filter.penSeen()) storeLearned(this.pipeline.learned());
    this.pipeline = null;
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    window.removeEventListener('pointerdown', this.onTouchDown, { capture: true });
    window.removeEventListener('pointerup', this.onTouchEnd, { capture: true });
    window.removeEventListener('pointercancel', this.onTouchEnd, { capture: true });
    window.removeEventListener('pointerdown', this.onPalmPress, true);
    window.removeEventListener('pointerup', this.onPalmPress, true);
    window.removeEventListener('click', this.onClick, true);
  }

  private accepts(event: PointerEvent): boolean {
    if (event.pointerType !== 'touch' || !this.active()) return false;
    // A finger on the grip or width handle of a selected or edited text box moves or resizes it; a palm stays here.
    return palmSized(event) || !onObjectHandle(this.host, event);
  }

  /**
   * A pen tool is active on an editable page, and the palm filter has loaded. Every pen tool counts: a palm
   * must not pan the page under the eraser either.
   */
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
    this.lastPenAt = event.timeStamp;
    if (!this.pipeline && !this.active()) return;
    const pipeline = this.ensure();
    const type =
      event.type === 'pointerdown'
        ? 'down'
        : event.type === 'pointerup'
          ? 'up'
          : event.type === 'pointercancel'
            ? 'cancel'
            : 'move';
    pipeline.handle(fill(this.record, event, type));
    if (!this.penKept && pipeline.filter.penSeen()) {
      this.penKept = true;
      storeLearned(pipeline.learned());
    }
  };

  /** The pen this session saw is stored, so the next launch starts with fingers navigating. */
  private penKept = false;

  private lastPenAt = -Infinity;
  /** Palm-sized touches still down or just lifted, by pointer id: when each landed. */
  private readonly palms = new Map<number, number>();

  /** Notes a palm-sized touch, whether it landed before, or after the pen: its click is dropped if the pen was in use. */
  private readonly onTouchDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || !this.active()) return;
    if (palmSized(event)) this.palms.set(event.pointerId, event.timeStamp);
  };

  private readonly onTouchEnd = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || !this.palms.has(event.pointerId)) return;
    // The click of this lift follows at once; forget the contact right after it.
    setTimeout(() => this.palms.delete(event.pointerId), 50);
  };

  /** Drops the click of a palm-sized touch, however long it rested, when the pen was in use around it. A pen's own click passes. */
  private readonly onClick = (event: MouseEvent) => {
    const id = (event as PointerEvent).pointerId;
    const landed = this.palms.get(id);
    if (landed === undefined || (event as PointerEvent).pointerType === 'pen') return;
    if (this.lastPenAt < landed - PEN_RECENT_MS) return;
    event.preventDefault();
    event.stopPropagation();
  };

  /** Controls that press on pointerdown or pointerup (menus, pickers, toolbars) never hear a palm while the pen is in use. */
  private readonly onPalmPress = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || !palmSized(event) || !this.active()) return;
    if (this.lastPenAt < (this.palms.get(event.pointerId) ?? event.timeStamp) - PEN_RECENT_MS) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(PRESSABLE)) event.stopImmediatePropagation();
  };

  private readonly onBlur = () => this.pipeline?.system('blur', performance.now());

  private ensure(): InkPipeline {
    if (this.pipeline) return this.pipeline;
    const palm = this.palm!;
    const made = palm.createInkPipeline(
      this.pipelineHost(),
      palmSettings(palm),
      { platform: 'windows' },
      storedLearned(),
    );
    made.setInkToolActive(writesInk(drawState.get().tool));
    this.pipeline = made;
    this.syncViewport();
    this.tick = setInterval(() => {
      if (made.needsTick()) made.tick(performance.now());
    }, 100);
    return made;
  }

  /**
   * Tells the filter the window's size, for the edge-grip and edge-start rules: a thumb rests at the device's edge,
   * not at the page pane's, so the pages pane being open does not move the edge.
   */
  private syncViewport(): void {
    if (this.pipeline) this.pipeline.filter.setViewport(window.innerWidth, window.innerHeight);
  }

  private readonly onResize = () => this.syncViewport();

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
      this.rulerFrom.delete(id);
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
    if (hold.kind === 'ruler') {
      const from = this.rulerFrom.get(id) ?? { x: out.x, y: out.y };
      this.rulerFrom.set(id, from);
      showRulerLength(from, out);
    }
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
      if (!this.tapOnObject(id) && ink.strokes) void surface.add(ink.strokes);
    }
    if (phase === 'uncommit' && ink.strokes && !this.swallowed.delete(id)) {
      void surface.remove(ink.strokes.map((s) => s.id));
    }
    if (phase === 'retract' || phase === 'commit') this.contacts.delete(id);
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

  /**
   * A finger that draws and stays still on a text box or picture (a quick tap or a held one) selects it instead of
   * leaving a dot; in the box being edited, it puts the caret there. A finger's dot has no use on a box, and before a
   * pen is seen every finger draws, so a tap must still select. True when the tap was taken, so it leaves no ink.
   */
  private tapOnObject(id: number): boolean {
    const contact = this.contacts.get(id);
    if (!contact || contact.travel > TAP_SLOP_PX) return false;
    const at = this.host.viewport.get()?.toWorld(contact.x0, contact.y0);
    const object = at ? objectAt(this.host, at) : null;
    if (!object) return false;
    this.swallowed.add(id);
    if (!isEditing(this.host, object)) selectObject(this.host, object);
    else {
      const el = document.elementsFromPoint(contact.x0, contact.y0).find((e) => !(e instanceof HTMLCanvasElement));
      if (el) placeCaret(el, contact.x0, contact.y0);
    }
    return true;
  }

  /**
   * A tap the filter allows does what a tap does. It clicks a checkbox or link. It selects the text box or picture it
   * landed on, so the selection frame can move, resize, or delete it. In the text box being edited, it puts the caret
   * where it landed. A tap on empty page lets go of the selection.
   */
  private tapAt(id: number, allowed: boolean): void {
    const hit = allowed ? this.under(id) : null;
    if (!hit) return;
    const { el, x, y } = hit;
    if (!el.closest(CONTROLS) && this.tapObject(x, y)) return;
    placeCaret(el, x, y);
    const target = el.closest(CONTROLS);
    if (target instanceof HTMLElement) target.click();
  }

  /** Selects the text box or picture a tap landed on, or lets go of the selection on empty page. True when it acted. */
  private tapObject(x: number, y: number): boolean {
    const at = this.host.viewport.get()?.toWorld(x, y);
    const object = at ? objectAt(this.host, at) : null;
    if (object && isEditing(this.host, object)) return false;
    if (object) {
      selectObject(this.host, object);
      return true;
    }
    const selection = this.host.selection.get();
    if (selection.blocks.length + selection.strokes.length === 0) return false;
    this.host.select({ blocks: [], strokes: [] });
    return false;
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
