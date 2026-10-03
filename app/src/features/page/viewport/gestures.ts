// The page's own pan and pinch (ARCHITECTURE.md section 5.2; owner WP3), the router's `gestures` tool at priority
// 50. The viewport has touch-action: none, so the browser never pans for touch or pen by itself.
// - One finger pans after 8 px, with a short glide after a flick (none with reduced motion).
// - Two fingers pan and pinch together, around their midpoint.
// - A pen drag with the barrel button held, and a middle-button drag, pan too.
// Scroll offsets are written once per animation frame from coalesced moves, and snap to device pixels when the
// gesture ends. While anything holds the camera (Phase 5 does while a pen is down), nothing here moves the page.
import { prefersReducedMotion } from '../../../shell/layout/motion';
import type { Point } from './camera';
import type { PointerToolDef, RouterContext } from './router';
import type { PageViewport } from './viewport';

/** Touch moves this far before it pans; less is a tap. */
export const TOUCH_SLOP = 8;
/** A barrel-button pen drag moves this far before it pans; less is a press that opens the menu. */
export const PEN_SLOP = 4;
/** A glide lasts at most this long. */
export const GLIDE_MS = 400;
/** The glide's speed falls by e every this many milliseconds. */
const GLIDE_DECAY_MS = 110;
/** Flicks slower than this (CSS px per ms) don't glide. */
const GLIDE_MIN_SPEED = 0.08;
/** Moves older than this don't count toward a flick's speed. */
const VELOCITY_WINDOW_MS = 100;

const BARREL = 2;
const MIDDLE = 1;

interface Contact {
  start: Point;
  last: Point;
  pen: boolean;
}

type Mode = 'none' | 'pan' | 'pinch';

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function middle(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const at = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY });

/** The speed of the moves in the last VELOCITY_WINDOW_MS, in CSS px per ms. */
function flickSpeed(samples: readonly { t: number; dx: number; dy: number }[], now: number): Point {
  const recent = samples.filter((sample) => now - sample.t <= VELOCITY_WINDOW_MS);
  const span = recent.length > 1 ? now - recent[0]!.t : 0;
  if (span <= 0) return { x: 0, y: 0 };
  return {
    x: recent.reduce((sum, sample) => sum + sample.dx, 0) / span,
    y: recent.reduce((sum, sample) => sum + sample.dy, 0) / span,
  };
}

export interface GestureTool extends PointerToolDef {
  /** Whether a pan, pinch, or glide is moving the page. */
  busy(): boolean;
  destroy(): void;
}

class Gestures implements GestureTool {
  readonly id = 'gestures';
  readonly priority = 50;
  private readonly contacts = new Map<number, Contact>();
  private mode: Mode = 'none';
  private pending = { dx: 0, dy: 0, pinch: null as { zoom: number; focus: Point } | null };
  private frame = 0;
  private glide = 0;
  private samples: { t: number; dx: number; dy: number }[] = [];
  private pinchStart: { distance: number; zoom: number } | null = null;
  private stopMenu: (() => void) | null = null;

  constructor(
    private readonly viewport: PageViewport,
    private readonly view: Window,
  ) {}

  accepts(event: PointerEvent): boolean {
    if (this.viewport.held()) return false;
    if (event.pointerType === 'touch') return true;
    if (event.pointerType === 'pen') return event.button === BARREL || (event.buttons & 2) !== 0;
    return event.pointerType === 'mouse' && event.button === MIDDLE;
  }

  down(event: PointerEvent, ctx: RouterContext): 'claim' | 'watch' {
    this.stopGlide();
    this.contacts.set(event.pointerId, { start: at(event), last: at(event), pen: event.pointerType === 'pen' });
    if (event.pointerType === 'mouse') {
      ctx.capture(event.pointerId);
      this.beginPan();
      return 'claim';
    }
    if (event.pointerType === 'touch' && this.contacts.size === 2) {
      ctx.capture(event.pointerId);
      this.beginPinch();
      return 'claim';
    }
    return this.contacts.size > 2 ? 'claim' : 'watch';
  }

  move(events: readonly PointerEvent[], ctx: RouterContext): 'claim' | 'watch' | 'release' {
    const last = events.at(-1);
    const contact = last && this.contacts.get(last.pointerId);
    if (!last || !contact) return 'release';
    if (this.mode === 'none') {
      if (distance(at(last), contact.start) < (contact.pen ? PEN_SLOP : TOUCH_SLOP)) return 'watch';
      if (this.viewport.held()) {
        this.contacts.delete(last.pointerId);
        return 'release';
      }
      ctx.capture(last.pointerId);
      this.beginPan();
    }
    for (const event of events) this.moveContact(event.pointerId, at(event));
    this.frame ||= this.view.requestAnimationFrame(this.flush);
    return 'claim';
  }

  up(event: PointerEvent): void {
    const contact = this.contacts.get(event.pointerId);
    this.contacts.delete(event.pointerId);
    if (contact?.pen && this.mode === 'pan') this.swallowMenu();
    if (this.mode === 'pinch' && this.contacts.size === 1) {
      // One finger lifted: the other keeps panning.
      if (this.frame) this.flush();
      this.viewport.endGesture('pinch');
      this.pinchStart = null;
      return this.beginPan();
    }
    if (this.contacts.size === 0) this.endAll(true);
  }

  cancel(): void {
    this.endAll(false);
  }

  busy(): boolean {
    return this.mode !== 'none' || this.glide !== 0;
  }

  destroy(): void {
    if (this.frame) this.view.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.stopGlide();
    this.stopMenu?.();
    this.endAll(false);
  }

  private readonly flush = () => {
    this.frame = 0;
    const next = this.pending;
    this.pending = { dx: 0, dy: 0, pinch: null };
    if (this.viewport.held()) return;
    if (next.pinch) this.viewport.zoomAt(next.pinch.zoom, next.pinch.focus, 'pinch');
    if (next.dx !== 0 || next.dy !== 0) this.viewport.panBy(next.dx, next.dy);
  };

  private moveContact(id: number, to: Point): void {
    const contact = this.contacts.get(id);
    if (!contact) return;
    const from = contact.last;
    contact.last = to;
    if (this.mode === 'pan') {
      this.pending.dx += from.x - to.x;
      this.pending.dy += from.y - to.y;
      this.samples.push({ t: this.view.performance.now(), dx: from.x - to.x, dy: from.y - to.y });
      if (this.samples.length > 32) this.samples.shift();
      return;
    }
    const [a, b] = [...this.contacts.values()];
    if (this.mode !== 'pinch' || !this.pinchStart || !a || !b) return;
    // The fingers' midpoint moves the page with them, and their spread zooms around that midpoint.
    const before = middle(contact === a ? from : a.last, contact === b ? from : b.last);
    const after = middle(a.last, b.last);
    this.pending.dx += before.x - after.x;
    this.pending.dy += before.y - after.y;
    const zoom = (this.pinchStart.zoom * distance(a.last, b.last)) / this.pinchStart.distance;
    this.pending.pinch = { zoom, focus: after };
  }

  private beginPan(): void {
    this.mode = 'pan';
    this.samples = [];
    this.viewport.beginGesture('touchPan');
  }

  private beginPinch(): void {
    const [a, b] = [...this.contacts.values()];
    if (!a || !b) return;
    if (this.mode === 'pan') this.viewport.endGesture('touchPan');
    this.mode = 'pinch';
    this.pinchStart = { distance: Math.max(1, distance(a.last, b.last)), zoom: this.viewport.camera().zoom };
    this.viewport.beginGesture('pinch');
  }

  private endAll(withGlide: boolean): void {
    if (this.frame) this.flush();
    if (this.mode === 'pinch') this.viewport.endGesture('pinch');
    if (this.mode === 'pan' && withGlide) this.startGlide();
    else if (this.mode === 'pan') this.viewport.endGesture('touchPan');
    this.mode = 'none';
    this.pinchStart = null;
    this.contacts.clear();
  }

  private startGlide(): void {
    const began = this.view.performance.now();
    const speed = flickSpeed(this.samples, began);
    this.samples = [];
    if (prefersReducedMotion(this.view) || Math.hypot(speed.x, speed.y) < GLIDE_MIN_SPEED) {
      return this.viewport.endGesture('touchPan');
    }
    let last = began;
    const step = (time: number) => {
      const dt = Math.max(0, time - last);
      last = time;
      const decay = Math.exp(-dt / GLIDE_DECAY_MS);
      speed.x *= decay;
      speed.y *= decay;
      if (!this.viewport.held()) this.viewport.panBy(speed.x * dt, speed.y * dt);
      if (time - began < GLIDE_MS && Math.hypot(speed.x, speed.y) >= GLIDE_MIN_SPEED / 4) {
        this.glide = this.view.requestAnimationFrame(step);
        return;
      }
      this.glide = 0;
      this.viewport.endGesture('touchPan');
    };
    this.glide = this.view.requestAnimationFrame(step);
  }

  private stopGlide(): void {
    if (!this.glide) return;
    this.view.cancelAnimationFrame(this.glide);
    this.glide = 0;
    this.viewport.endGesture('touchPan');
  }

  /** A barrel-button press opens the menu; after a barrel pan, the menu that follows is swallowed. */
  private swallowMenu(): void {
    this.stopMenu?.();
    const onMenu = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      this.stopMenu?.();
    };
    this.view.addEventListener('contextmenu', onMenu, { capture: true });
    const timer = this.view.setTimeout(() => this.stopMenu?.(), 600);
    this.stopMenu = () => {
      this.view.removeEventListener('contextmenu', onMenu, { capture: true });
      this.view.clearTimeout(timer);
      this.stopMenu = null;
    };
  }
}

export function createGestureTool(viewport: PageViewport, view: Window = window): GestureTool {
  return new Gestures(viewport, view);
}
