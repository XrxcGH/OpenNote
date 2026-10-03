// The ink input pipeline: one wiring module that the page view and the replayer share, so the accuracy the replayer
// measures is the accuracy of the shipped wiring. It owns the palm filter, the multi-tap detector, `touchNav`, and
// the provisional touch stroke builders, and tells the host what to draw, commit, retract, scroll, and allow.
//
// A pen sample reaches the host in the call that delivers it: nothing here gates or delays a pen. A pen down first lets
// the filter end a touch scroll, so the camera it reverts is in place before the stroke's first point is mapped.
//
// A touch stroke stays hidden until the filter shows it (`Promote`) or it lifts, so a hand edge that lands first and
// settles never flashes ink; a real stroke then shows with its whole path. A dot shows at its lift, unless the filter
// keeps it hidden until it commits (a pen about, or no contact sizes to tell a palm bounce).

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
  /** A multi-finger gesture. `silent` takes back one delivered just before a pen arrived, with no feedback. */
  gesture(kind: 'undo' | 'redo', silent: boolean): void;
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
/**
 * A gesture delivered this soon before a pen arrives in the tap's hand region is taken back, like ink [S16], when one
 * of its taps was itself a likely palm. Undo, then rewrite where the taps were, is the normal flow.
 */
const GESTURE_RETRACT_MS = 1000;
/** Lifts of tap fingers remembered for the gesture they make. */
const TAP_LIFTS = 8;
/** One-finger scroll starts from the point where it crossed slop, so the wait for it to settle loses no motion. */
const SLOP_MM = 1.5;

const inked = (role: Role) => role === Role.Draw || role === Role.Shadow || role === Role.Pend;

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
  /** Held strokes the filter keeps hidden: such a dot shows only when it commits. */
  private readonly hidden = new Set<number>();
  private readonly page = { x: 0, y: 0 };
  private readonly pxPerMm: number;
  private lastPen = -Infinity;
  private policy: TouchPolicy | null = null;
  private navStarts: number[] = [];
  /** A Wacom pen with Windows Ink off arrives as a mouse; it still writes, so it is still a pen. */
  private readonly penAsMouse: boolean;
  /** The last gesture delivered, where its taps landed (mm), and when, so a pen that arrives can take it back. */
  private lastGesture: { kind: 'undo' | 'redo'; t: number; x: number; y: number; palm: boolean } | null = null;
  private tapX = 0;
  private tapY = 0;
  /** Contacts fed to the multi-tap detector, and when the last few of them lifted and whether each was a palm. */
  private readonly tapIds = new Set<number>();
  private readonly liftT = new Float64Array(TAP_LIFTS).fill(-Infinity);
  private readonly liftPalm = new Uint8Array(TAP_LIFTS);
  private liftNext = 0;

  constructor(
    private readonly host: PipelineHost,
    settings: Partial<PalmSettings>,
    profile: Partial<DeviceProfile>,
    learned?: LearnedState,
  ) {
    this.filter = createPalmFilter(settings, profile, learned);
    this.pxPerMm = resolvePxPerMm(profile.pxPerMm, learned?.pxPerMmCalibrated, profile.platform);
    this.penAsMouse = profile.id === 'windows-pen-as-mouse';
    this.syncPolicy();
  }

  handle(r: PointerRecord): void {
    if (r.kind === 'pen' || (r.kind === 'mouse' && this.penAsMouse)) this.pen(r);
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
    if (gesture) {
      this.host.gesture(gesture, false);
      this.lastGesture = { kind: gesture, t, x: this.tapX, y: this.tapY, palm: this.palmTaps(t) };
    }
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
    const sample = contact && r.type !== 'cancel' && r.type !== 'leave';
    // A down that ends a touch scroll reverts the camera first (the filter call is constant time), so the stroke maps
    // its first point with the camera it keeps. Every other sample goes to the host before anything else runs.
    const down = r.type === 'down';
    if (sample && !down) this.host.penSample(r);
    const signal = r.type === 'move' ? (r.buttons !== 0 ? 'move' : 'hover') : r.type === 'down' ? 'down' : r.type;
    this.filter.pen(signal, r.id, r.t, r.x, r.y, r.tiltX, r.tiltY);
    if (signal !== 'leave') {
      this.lastPen = r.t;
      this.taps.cancel();
      this.takeBackGesture(r.t);
    }
    this.drain(r.t);
    if (sample && down) this.host.penSample(r);
  }

  /** Whether a tap finger that lifted in the last second was a likely palm. */
  private palmTaps(t: number): boolean {
    for (let k = 0; k < TAP_LIFTS; k++) {
      if (t - this.liftT[k] <= GESTURE_RETRACT_MS && this.liftPalm[k] === 1) return true;
    }
    return false;
  }

  /** A pen arrived just after a gesture, in the hand region where its taps landed, and a tap scored as a palm. */
  private takeBackGesture(t: number): void {
    const g = this.lastGesture;
    if (!g) return;
    if (t - g.t > GESTURE_RETRACT_MS || !g.palm) {
      this.lastGesture = null;
      return;
    }
    if (!this.filter.inHand(g.x * this.pxPerMm, g.y * this.pxPerMm)) return;
    this.lastGesture = null;
    this.host.gesture(g.kind === 'undo' ? 'redo' : 'undo', true);
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
    if (inked(role)) this.beginInk(r, e);
    this.drain(r.t);
    // Multi-tap hears every landing once the pen has been still for a second and is not near: undo works 1 s after
    // the pen is put down, as on the checklist. A palm verdict voids its group.
    const presence = f.presence(r.t);
    const quiet = presence !== 'down' && presence !== 'near' && r.t - this.lastPen >= TAP_AFTER_PEN_MS;
    if (!quiet || r.surface !== 'page' || e.suppressed) return;
    // With no contact size on a device that has seen a pen, a palm that settles twice looks like a two-finger double
    // tap, and only where it lands tells. In the writing hand's region of the last pen position or of the line being
    // written, on either side while the side is unknown, it is no tap. With sizes, its size voids the group.
    const guarded = f.penSeen() && !f.sizesReal();
    if (guarded && f.inHand(r.x, r.y)) return;
    const k = 1 / this.pxPerMm;
    this.tapIds.add(r.id);
    this.taps.down(r.id, r.x * k, r.y * k, r.w > 1 ? r.w * k : 0, r.h > 1 ? r.h * k : 0, r.t);
    this.tapX = r.x * k;
    this.tapY = r.y * k;
  }

  private touchMove(r: PointerRecord): void {
    const e = this.live.get(r.id);
    if (e) {
      e.x = r.x;
      e.y = r.y;
    }
    this.filter.touchMove(r.id, r.t, r.x, r.y, r.w, r.h, r.p);
    this.drain(r.t);
    if (!e) return;
    const k = 1 / this.pxPerMm;
    this.taps.move(r.id, r.x * k, r.y * k);
    if (inked(e.role) && e.ink) {
      this.push(e.ink, r);
      this.host.touchStroke(r.id, e.visible ? 'point' : 'shadow', e.ink);
    } else if (this.nav.owns(r.id) && this.nav.move(r.id, r.x, r.y, r.t)) {
      const s = this.nav.step;
      this.host.camera('panBy', r.id, s.dx, s.dy, 0);
      if (s.scale !== 1) this.host.camera('zoomAt', r.id, s.cx, s.cy, s.scale);
    }
  }

  private touchEnd(r: PointerRecord): void {
    const e = this.live.get(r.id);
    const canceled = r.type === 'cancel';
    const ink = e && inked(e.role) ? e.ink : null;
    if (ink && !canceled) this.push(ink, r);
    const bits = this.filter.touchEnd(r.id, r.t, canceled);
    if (this.tapIds.delete(r.id)) {
      this.liftT[this.liftNext] = r.t;
      this.liftPalm[this.liftNext] = this.filter.palmTap(r.id) ? 1 : 0;
      this.liftNext = (this.liftNext + 1) % TAP_LIFTS;
    }
    if (ink && (bits & End.Held) !== 0) this.hold(r.id, ink, (bits & End.Hidden) !== 0);
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

  /** A lifted stroke waits for its commit. A dot shows now, unless `hidden`: a pen is in use and a palm bounces so. */
  private hold(id: number, ink: TouchInk, hidden: boolean): void {
    const e = this.live.get(id);
    if (e && !e.visible) {
      if (hidden) this.hidden.add(id);
      else this.show(id, e);
    }
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
    if (bits & Fx.Hold && e?.ink) this.hold(id, e.ink, !e.visible);
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
    if (this.hidden.delete(id) || (e?.ink === ink && !e.visible)) {
      if (e) e.visible = true;
      this.host.touchStroke(id, 'show', ink);
    }
    ink.strokes ??= ink.builder.finish();
    this.host.touchStroke(id, 'commit', ink);
    this.held.delete(id);
    if (e) e.ink = null;
    this.committed.set(id, ink);
    if (this.committed.size > 4) this.committed.delete(this.committed.keys().next().value!);
  }

  private start(id: number, role: Role, e: Entry, t: number): void {
    if (role === Role.Nav) {
      this.navStarts.push(id);
      return;
    }
    if (role !== Role.Scroll) return;
    // Start from where the contact crossed slop and move the camera by the rest at once, so nothing is lost while
    // the filter waited for the contact to settle.
    const dx = e.x - e.x0;
    const dy = e.y - e.y0;
    const d = Math.hypot(dx, dy);
    const k = d > 0 ? Math.min(1, (SLOP_MM * this.pxPerMm) / d) : 1;
    this.nav.beginScroll(id, e.x0 + dx * k, e.y0 + dy * k, t);
    if (this.nav.move(id, e.x, e.y, t)) this.host.camera('panBy', id, this.nav.step.dx, this.nav.step.dy, 0);
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
