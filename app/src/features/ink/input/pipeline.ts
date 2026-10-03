// The ink input pipeline: one wiring module that the page view and the replayer share, so the accuracy the replayer
// measures is the accuracy of the shipped wiring. It owns the palm filter, the multi-tap detector, `touchNav`, and
// the provisional touch stroke builders, and tells the host what to draw, commit, retract, scroll, and allow.
// A pen sample goes straight to the host before anything else runs: nothing here gates or delays a pen.
// A touch stroke stays hidden until its contact moves 0.5 mm or lifts, so a hand edge that lands first and rests
// never flashes a dot; a real stroke shows from its first sample once it moves, which takes a few ms.

import { createMultiTapDetector } from './gestures/multiTap';
import { createPalmFilter, End, Fx, Role, resolvePxPerMm } from './palm/index';
import type { DeviceProfile, LearnedState, PalmFilter, PalmSettings, Surface, SystemSignal } from './palm/index';
import type { TouchPolicy } from './palm/index';
import type { StrokeBuilder } from './strokeBuilder';
import type { InkStroke } from '../model/types';
import { TouchNav } from './touchNav';

export type PointerKind = 'pen' | 'touch' | 'mouse';
export type RecordType = 'down' | 'move' | 'up' | 'cancel' | 'leave';

/** One pointer event as plain data. The page view reuses one record per event. Positions are client CSS px. */
export interface PointerRecord {
  type: RecordType;
  id: number;
  kind: PointerKind;
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
  p: number;
  tiltX: number;
  tiltY: number;
  buttons: number;
  surface: Surface;
}

/** Shadow: built, not shown. Show: shown with its whole path so far. Point: one more shown point. */
export type TouchStrokePhase = 'shadow' | 'show' | 'point' | 'retract' | 'hold' | 'commit' | 'uncommit';
export type CameraOp = 'snapshot' | 'panBy' | 'zoomAt' | 'fling' | 'revert' | 'release';

/** A touch stroke as the host sees it: the builder while it draws, and the finished strokes after the lift. */
export interface TouchInk {
  readonly id: number;
  readonly builder: StrokeBuilder;
  strokes: InkStroke[] | null;
}

export interface PipelineHost {
  /** A pen sample, straight to the active tool. */
  penSample(record: PointerRecord): void;
  /** A builder for a touch stroke, with the active tool and the camera at contact. */
  touchBuilder(id: number, record: PointerRecord): StrokeBuilder;
  /** The record's position in page units, for the touch builder. */
  toPage(record: PointerRecord, out: { x: number; y: number }): void;
  touchStroke(id: number, phase: TouchStrokePhase, ink: TouchInk): void;
  /** `panBy` (a, b) px; `zoomAt` (a, b) by c; `fling` velocity (a, b) px per ms; `snapshot`, `revert`, `release`. */
  camera(op: CameraOp, id: number, a: number, b: number, c: number): void;
  tap(id: number, allowed: boolean): void;
  contextMenu(id: number, allowed: boolean): void;
  gesture(kind: 'undo' | 'redo'): void;
  touchPolicy(policy: TouchPolicy): void;
}

export interface InkPipeline {
  readonly filter: PalmFilter;
  handle(record: PointerRecord): void;
  system(signal: SystemSignal, t: number): void;
  tick(t: number): void;
  needsTick(): boolean;
  /** When a held stroke commits: tick then as well as every 100 ms. */
  nextDue(): number;
  setInkToolActive(active: boolean): void;
  learned(): LearnedState;
}

/** Multi-tap waits this long after pen evidence. */
const TAP_AFTER_PEN_MS = 1000;
const LONG_PRESS_MS = 500;
/** A drawing contact shows its ink once it has moved this far, in mm, or at its lift. */
const SHOW_AFTER_MM = 0.5;

interface Entry {
  role: Role;
  x: number;
  y: number;
  x0: number;
  y0: number;
  visible: boolean;
  t0: number;
  ink: TouchInk | null;
  suppressed: boolean;
  pressAsked: boolean;
}

class Pipeline implements InkPipeline {
  readonly filter: PalmFilter;
  private readonly taps = createMultiTapDetector();
  private readonly nav = new TouchNav();
  private readonly live = new Map<number, Entry>();
  /** Lifted strokes waiting for a Commit or a Retract, and recent commits that may be taken back. */
  private readonly held = new Map<number, TouchInk>();
  private readonly committed = new Map<number, TouchInk>();
  /** Held strokes that never moved: a dot shows only when it commits. */
  private readonly hidden = new Set<number>();
  private readonly page = { x: 0, y: 0 };
  private readonly pxPerMm: number;
  private lastPen = -Infinity;
  private policy: TouchPolicy | null = null;
  private navStarts: number[] = [];

  constructor(
    private readonly host: PipelineHost,
    settings: Partial<PalmSettings>,
    profile: Partial<DeviceProfile>,
    learned?: LearnedState,
  ) {
    this.filter = createPalmFilter(settings, profile, learned);
    this.pxPerMm = resolvePxPerMm(profile.pxPerMm, learned?.pxPerMmCalibrated);
    this.syncPolicy();
  }

  handle(r: PointerRecord): void {
    if (r.kind === 'pen') this.pen(r);
    else if (r.kind === 'touch') this.touch(r);
    this.syncPolicy();
  }

  system(signal: SystemSignal, t: number): void {
    this.filter.system(signal, t);
    this.drain(t);
    if (signal !== 'penCaptureLost') this.taps.cancel();
    this.syncPolicy();
  }

  tick(t: number): void {
    this.filter.tick(t);
    this.drain(t);
    const gesture = this.taps.poll(t);
    if (gesture) this.host.gesture(gesture);
    for (const [id, e] of this.live) {
      if (e.pressAsked || t - e.t0 < LONG_PRESS_MS) continue;
      e.pressAsked = true;
      this.host.contextMenu(id, !e.suppressed && this.filter.pressAllowed(id, t));
    }
  }

  needsTick(): boolean {
    return this.filter.needsTick() || this.live.size > 0;
  }

  nextDue(): number {
    return this.filter.nextDue();
  }

  learned(): LearnedState {
    return this.filter.learned();
  }

  setInkToolActive(active: boolean): void {
    this.filter.setInkToolActive(active);
    this.syncPolicy();
  }

  private pen(r: PointerRecord): void {
    const contact = r.buttons !== 0 || r.type === 'down' || r.type === 'up';
    if (contact && r.type !== 'cancel' && r.type !== 'leave') this.host.penSample(r);
    const signal = r.type === 'move' ? (r.buttons !== 0 ? 'move' : 'hover') : r.type === 'down' ? 'down' : r.type;
    this.filter.pen(signal, r.id, r.t, r.x, r.y, r.tiltX, r.tiltY);
    if (signal !== 'leave') {
      this.lastPen = r.t;
      this.taps.cancel();
    }
    this.drain(r.t);
  }

  private touch(r: PointerRecord): void {
    if (r.type === 'down') this.touchDown(r);
    else if (r.type === 'move') this.touchMove(r);
    else if (r.type === 'up' || r.type === 'cancel') this.touchEnd(r);
  }

  private touchDown(r: PointerRecord): void {
    const f = this.filter;
    const role = f.touchDown(r.id, r.t, r.x, r.y, r.w, r.h, r.p, r.surface);
    this.host.camera('snapshot', r.id, 0, 0, 0);
    const e: Entry = {
      role,
      x: r.x,
      y: r.y,
      x0: r.x,
      y0: r.y,
      visible: false,
      t0: r.t,
      ink: null,
      suppressed: false,
      pressAsked: false,
    };
    this.live.set(r.id, e);
    if (role === Role.Draw || role === Role.Shadow) this.beginInk(r, e);
    this.drain(r.t);
    const presence = f.presence(r.t);
    const quiet = (presence === 'away' || presence === 'absent') && r.t - this.lastPen >= TAP_AFTER_PEN_MS;
    if (quiet && r.surface === 'page' && !e.suppressed) {
      const k = 1 / this.pxPerMm;
      this.taps.down(r.id, r.x * k, r.y * k, r.w > 1 ? r.w * k : 0, r.h > 1 ? r.h * k : 0, r.t);
    }
  }

  private touchMove(r: PointerRecord): void {
    const e = this.live.get(r.id);
    this.filter.touchMove(r.id, r.t, r.x, r.y, r.w, r.h, r.p);
    this.drain(r.t);
    if (!e) return;
    e.x = r.x;
    e.y = r.y;
    const k = 1 / this.pxPerMm;
    this.taps.move(r.id, r.x * k, r.y * k);
    if ((e.role === Role.Draw || e.role === Role.Shadow) && e.ink) {
      this.push(e.ink, r);
      const moved = Math.hypot(r.x - e.x0, r.y - e.y0) >= SHOW_AFTER_MM * this.pxPerMm;
      if (e.role === Role.Draw && !e.visible && moved) this.show(r.id, e);
      else this.host.touchStroke(r.id, e.visible ? 'point' : 'shadow', e.ink);
    } else if (this.nav.owns(r.id) && this.nav.move(r.id, r.x, r.y, r.t)) {
      const s = this.nav.step;
      this.host.camera('panBy', r.id, s.dx, s.dy, 0);
      if (s.scale !== 1) this.host.camera('zoomAt', r.id, s.cx, s.cy, s.scale);
    }
  }

  private touchEnd(r: PointerRecord): void {
    const e = this.live.get(r.id);
    const canceled = r.type === 'cancel';
    const wasDrawing = e?.role === Role.Draw;
    if (e?.ink && wasDrawing && !canceled) this.push(e.ink, r);
    const bits = this.filter.touchEnd(r.id, r.t, canceled);
    if (e?.ink && wasDrawing && !canceled && !e.visible && (bits & End.Held) === 0) this.show(r.id, e);
    if (e?.ink && wasDrawing && (bits & End.Held) !== 0) this.hold(r.id, e.ink);
    this.drain(r.t);
    if (this.nav.owns(r.id)) {
      const v = this.nav.end(r.id, r.t);
      if (v.vx !== 0 || v.vy !== 0) this.host.camera('fling', r.id, v.vx, v.vy, 0);
      else this.host.camera('release', r.id, 0, 0, 0);
    }
    this.host.tap(r.id, (bits & End.TapAllowed) !== 0 && !(e?.suppressed ?? true));
    this.taps.up(r.id, r.t, canceled);
    this.live.delete(r.id);
  }

  private beginInk(r: PointerRecord, e: Entry): void {
    e.ink = { id: r.id, builder: this.host.touchBuilder(r.id, r), strokes: null };
    this.push(e.ink, r);
    this.host.touchStroke(r.id, 'shadow', e.ink);
  }

  private show(id: number, e: Entry): void {
    e.visible = true;
    if (e.ink) this.host.touchStroke(id, 'show', e.ink);
  }

  private push(ink: TouchInk, r: PointerRecord): void {
    this.host.toPage(r, this.page);
    ink.builder.push({ x: this.page.x, y: this.page.y, time: r.t, pointerType: 'touch' });
  }

  private hold(id: number, ink: TouchInk): void {
    const e = this.live.get(id);
    if (e && !e.visible) this.hidden.add(id);
    ink.strokes ??= ink.builder.finish();
    this.held.set(id, ink);
    this.host.touchStroke(id, 'hold', ink);
  }

  /** Acts on the filter's effects from the last call. */
  private drain(t: number): void {
    const fx = this.filter.effects;
    this.navStarts.length = 0;
    for (let k = 0; k < fx.count; k++) this.apply(fx.id[k], fx.role[k] as Role, fx.fx[k], t);
    if (this.navStarts.length === 2) this.beginPinch(t);
  }

  private apply(id: number, role: Role, bits: number, t: number): void {
    const e = this.live.get(id);
    const ink = e?.ink ?? this.held.get(id) ?? null;
    if (bits & Fx.SuppressTap) {
      if (e) e.suppressed = true;
      this.taps.voidContact(id);
    }
    if (bits & Fx.Revert) this.host.camera('revert', id, 0, 0, 0);
    if ((bits & Fx.Revert || role === Role.Ignore) && this.nav.owns(id)) {
      this.nav.end(id, t);
      this.host.camera('release', id, 0, 0, 0);
    }
    if (bits & Fx.Retract && ink) {
      this.host.touchStroke(id, 'retract', ink);
      this.held.delete(id);
      this.hidden.delete(id);
      if (e) e.ink = null;
    }
    if (bits & Fx.Promote && e) this.show(id, e);
    if (bits & Fx.Hold && e?.ink) this.hold(id, e.ink);
    if (bits & Fx.Commit) this.commit(id, e, ink);
    if (bits & Fx.Uncommit) {
      const done = this.committed.get(id);
      if (done) this.host.touchStroke(id, 'uncommit', done);
      this.committed.delete(id);
    }
    if (bits & Fx.Start && e) this.start(id, role, e, t);
    if (e) e.role = role;
  }

  private commit(id: number, e: Entry | undefined, ink: TouchInk | null): void {
    if (!ink) return;
    if (this.hidden.delete(id)) this.host.touchStroke(id, 'show', ink);
    ink.strokes ??= ink.builder.finish();
    this.host.touchStroke(id, 'commit', ink);
    this.held.delete(id);
    if (e) e.ink = null;
    this.committed.set(id, ink);
    if (this.committed.size > 4) this.committed.delete(this.committed.keys().next().value!);
  }

  private start(id: number, role: Role, e: Entry, t: number): void {
    if (role === Role.Scroll) this.nav.beginScroll(id, e.x, e.y, t);
    else if (role === Role.Nav) this.navStarts.push(id);
  }

  private beginPinch(t: number): void {
    const [a, b] = this.navStarts;
    const ea = this.live.get(a)!;
    const eb = this.live.get(b)!;
    this.nav.beginPinch([a, b], [ea.x, eb.x], [ea.y, eb.y], t);
  }

  private syncPolicy(): void {
    const policy = this.filter.touchPolicy();
    if (policy === this.policy) return;
    this.policy = policy;
    this.host.touchPolicy(policy);
  }
}

/** One pipeline per page view. */
export function createInkPipeline(
  host: PipelineHost,
  settings: Partial<PalmSettings> = {},
  profile: Partial<DeviceProfile> = {},
  learned?: LearnedState,
): InkPipeline {
  return new Pipeline(host, settings, profile, learned);
}
