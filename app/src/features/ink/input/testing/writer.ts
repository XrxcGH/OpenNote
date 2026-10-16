// Builds labeled sessions from a simulated device: pen hover and strokes at the profile's rate, touch contacts with
// position and size over time, system events, and labels. Positions are mm; the writer renders them to client CSS px
// and to the sizes the profile's digitizer reports. Every number comes from the seeded random source.

import type { LearnedState, PalmSettings } from '../palm/index';
import type { SimProfile } from './profiles';
import { reportSize } from './profiles';
import { SESSION_FORMAT, SESSION_VERSION } from './session';
import type { Coalesced, EventType, Grip, Intent, LabelClass, Label, Session, SessionEvent } from './session';

/** A seeded random source (mulberry32). */
export type Rand = () => number;
export function seeded(seed: number): Rand {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const between = (r: Rand, lo: number, hi: number): number => lo + (hi - lo) * r();

export type Vec2 = readonly [number, number];
type Draft = Omit<SessionEvent, 'seq'> & { order: number };

export interface TouchSpec {
  readonly t0: number;
  readonly t1: number;
  /** Position in mm at time t. */
  readonly at: (t: number) => Vec2;
  /** Major and minor size in mm at time t. */
  readonly size: (t: number) => Vec2;
  readonly cls: LabelClass;
  readonly intent: Intent;
  readonly surface?: 'page' | 'chrome';
  /** The OS cancels the contact at this time instead of a lift. */
  readonly cancelAt?: number;
  /** The end event is lost. */
  readonly lostEnd?: boolean;
  readonly stepMs?: number;
  /** A known limit the contact falls under (`LIMITS` in hands.ts). */
  readonly limit?: string;
}

export interface WriterOptions {
  readonly handedness: 'right' | 'left';
  readonly grip: Grip;
  readonly settings: Partial<PalmSettings>;
  readonly learned?: LearnedState;
  readonly task: string;
  /** A pen sample rate other than the profile's, for coalesced batches. */
  readonly rateHz?: number;
  /** Pen strokes report zero pressure on their first and last samples. */
  readonly zeroPressureEnds?: boolean;
}

/** Sensor noise on a touch position, mm peak to peak. */
const JITTER_MM = 0.5;

export class SessionWriter {
  private readonly drafts: Draft[] = [];
  readonly labels: Label[] = [];
  private order = 0;
  private nextTouch = 100;
  /** Pen-down intervals, for devices that deliver no new touch while the pen is down, and pen hover intervals. */
  private readonly downs: [number, number][] = [];
  private readonly ranges: [number, number][] = [];
  penStrokes = 0;

  constructor(
    readonly profile: SimProfile,
    readonly rand: Rand,
    readonly options: WriterOptions,
  ) {}

  private emit(e: Omit<Draft, 'order'>): void {
    // A Wacom pen with Windows Ink off arrives as a mouse: no pressure, no tilt, and no leave on the root.
    if (e.pt === 'pen' && this.profile.device.id === 'windows-pen-as-mouse') {
      if (e.type === 'pointerleave') return;
      const { tx: _tx, ty: _ty, alt: _alt, az: _az, ...rest } = e;
      e = { ...rest, pt: 'mouse', p: (e.bs ?? 0) !== 0 ? 0.5 : 0 };
    }
    this.drafts.push({ ...e, order: this.order++ } as Draft);
  }

  private px(v: number): number {
    return Math.round(v * this.profile.cssPxPerMm * 100) / 100;
  }

  /** Pen tilt for this hand and grip: the pen leans toward the hand. */
  private tilt(): { tx: number; ty: number; alt?: number; az?: number } {
    const p = this.profile;
    if (p.tilt === 'none') return { tx: 0, ty: 0 };
    const sx = this.options.handedness === 'left' ? -1 : 1;
    const sy = this.options.grip === 'hooked' ? -1 : 1;
    const tx = sx * between(this.rand, 18, 30);
    const ty = sy * between(this.rand, 20, 32);
    if (p.tilt === 'degrees') return { tx, ty };
    const az = Math.atan2(Math.tan((ty * Math.PI) / 180), Math.tan((tx * Math.PI) / 180));
    return { tx, ty, alt: 1.0, az };
  }

  private get rate(): number {
    return this.options.rateHz ?? this.profile.rateHz;
  }

  /**
   * Hover samples from t0 to t1 along a path, at the pen rate. Some are lost on unstable digitizers; an AES pen may
   * lose proximity, leaving range for 300 to 700 ms and coming back. WebKit reports hover only on change, and Apple
   * Pencil hover has no tilt.
   */
  hover(t0: number, t1: number, at: (t: number) => Vec2, id = 1): void {
    const p = this.profile;
    if (p.stylus !== 'pen' || p.hover === 'none') return;
    this.ranges.push([t0, t1]);
    const step = 1000 / this.rate;
    const tilt = p.hoverTilt ? this.tilt() : {};
    const lost = t1 - t0 > 200 && this.rand() < p.proximityLoss ? between(this.rand, t0, t1 - 100) : Number.NaN;
    const back = lost + between(this.rand, 300, 700);
    let last = '';
    for (let t = t0; t <= t1; t += step * 2) {
      if (this.rand() < p.hoverDrop) continue;
      if (t >= lost && t < back) {
        if (t - step * 2 < lost) this.leave(t, id);
        continue;
      }
      const [x, y] = at(t);
      const key = `${this.px(x)},${this.px(y)}`;
      if (p.hoverOnChange && key === last) continue;
      last = key;
      this.emit({
        t,
        type: 'pointermove',
        id,
        pt: 'pen',
        x: this.px(x),
        y: this.px(y),
        p: 0,
        b: -1,
        bs: 0,
        ...tilt,
        target: 'page',
      });
    }
  }

  /** A pen stroke from t0 to t1. Returns its sample count. */
  stroke(t0: number, t1: number, at: (t: number) => Vec2, id = 1): number {
    const p = this.profile;
    const step = 1000 / this.rate;
    const tilt = this.tilt();
    const zeroEnds = this.options.zeroPressureEnds === true;
    const pressure = (t: number) =>
      zeroEnds && (t === t0 || t + step > t1)
        ? 0
        : p.pressureLevels === 0
          ? 0.5
          : Math.round((0.25 + 0.4 * Math.sin(((t - t0) / (t1 - t0)) * Math.PI)) * 1000) / 1000;
    let n = 0;
    for (let t = t0; t <= t1; t += step) {
      const [x, y] = at(t);
      const type: EventType = t === t0 ? 'pointerdown' : 'pointermove';
      this.emit({
        t,
        type,
        id,
        pt: 'pen',
        x: this.px(x),
        y: this.px(y),
        p: pressure(t),
        b: t === t0 ? 0 : -1,
        bs: 1,
        ...tilt,
        target: 'page',
      });
      n++;
    }
    const [x, y] = at(t1);
    this.emit({
      t: t1 + 1,
      type: 'pointerup',
      id,
      pt: 'pen',
      x: this.px(x),
      y: this.px(y),
      p: 0,
      b: 0,
      bs: 0,
      ...tilt,
      target: 'page',
    });
    this.labels.push({ type: 'label', id, from: t0, to: t1 + 1, cls: 'pen', intent: 'ink' });
    this.downs.push([t0, t1 + 1]);
    this.penStrokes++;
    return n + 1;
  }

  /** The pen leaves hover range: `pointerleave` on the document root. */
  leave(t: number, id = 1): void {
    if (this.profile.stylus !== 'pen') return;
    this.emit({ t, type: 'pointerleave', id, pt: 'pen', x: 0, y: 0, b: -1, bs: 0, target: 'root' });
  }

  /** A touch contact. Returns its id, or -1 when the device would never deliver it (pen down on iPadOS). */
  touch(spec: TouchSpec): number {
    const p = this.profile;
    if (p.blocksTouchWhileDown && this.downs.some(([a, b]) => spec.t0 >= a && spec.t0 <= b)) return -1;
    if (p.blocksTouchInRange && [...this.downs, ...this.ranges].some(([a, b]) => spec.t0 >= a && spec.t0 <= b)) {
      return -1;
    }
    const id = this.nextTouch++;
    const step = spec.stepMs ?? 12;
    const end = spec.cancelAt !== undefined && spec.cancelAt < spec.t1 ? spec.cancelAt : spec.t1;
    const target = spec.surface ?? 'page';
    for (let t = spec.t0; t < end; t += step) {
      const [x, y] = spec.at(t);
      const [w, h] = reportSize(p, ...spec.size(t));
      const jx = (this.rand() - 0.5) * JITTER_MM;
      const jy = (this.rand() - 0.5) * JITTER_MM;
      const type = t === spec.t0 ? 'pointerdown' : 'pointermove';
      this.emit({
        t,
        type,
        id,
        pt: 'touch',
        x: this.px(x + jx),
        y: this.px(y + jy),
        w,
        h,
        p: 0,
        b: t === spec.t0 ? 0 : -1,
        bs: 1,
        target,
      });
    }
    if (!spec.lostEnd) {
      const [x, y] = spec.at(end);
      const type = end === spec.cancelAt ? 'pointercancel' : 'pointerup';
      this.emit({ t: end, type, id, pt: 'touch', x: this.px(x), y: this.px(y), w: 1, h: 1, p: 0, b: 0, bs: 0, target });
    }
    const label = { type: 'label', id, from: spec.t0, to: end, cls: spec.cls, intent: spec.intent } as const;
    this.labels.push(spec.limit ? { ...label, limit: spec.limit } : label);
    return id;
  }

  /** Removes the last event of a type for a pointer, as a device that lost it. */
  dropLast(type: EventType, id: number): void {
    for (let k = this.drafts.length - 1; k >= 0; k--) {
      if (this.drafts[k].type === type && this.drafts[k].id === id) {
        this.drafts.splice(k, 1);
        return;
      }
    }
  }

  /** The OS cancel for a palm on this profile, or undefined. */
  osCancel(t0: number): number | undefined {
    return this.rand() < this.profile.osCancel ? t0 + this.profile.osCancelMs + between(this.rand, 0, 120) : undefined;
  }

  system(type: 'blur' | 'focus' | 'pageswitch', t: number): void {
    this.emit({ t, type });
  }

  visibility(hidden: boolean, t: number): void {
    this.emit({ t, type: 'visibility', hidden });
  }

  tool(on: boolean, t: number): void {
    this.emit({ t, type: 'tool', on });
  }

  build(): Session {
    const sorted = coalesce(
      [...this.drafts].sort((a, b) => a.t - b.t || a.order - b.order),
      this.profile.frameHz,
    );
    const events = sorted.map(({ order: _order, ...e }, seq) => ({ seq, ...e }) as SessionEvent);
    const p = this.profile;
    return {
      header: {
        format: SESSION_FORMAT,
        version: SESSION_VERSION,
        device: { os: p.device.platform ?? 'unknown', model: p.name, digitizer: p.size, penFamily: p.id },
        profile: p.id,
        capabilities: {
          hover: p.hover,
          pressureLevels: p.pressureLevels,
          tiltMode: p.tilt,
          sizeMode: p.size,
          rateHz: p.rateHz,
        },
        screen: {
          dpr: 1,
          cssPxPerMm: p.cssPxPerMm,
          refreshHz: p.frameHz,
          w: this.px(p.screenMm[0]),
          h: this.px(p.screenMm[1]),
        },
        webview: 'synthetic',
        handedness: this.options.handedness,
        grip: this.options.grip,
        posture: 'desk',
        settings: this.options.settings,
        learned: this.options.learned,
        task: this.options.task,
        consent: true,
      },
      events,
      labels: this.labels,
      expects: [],
    };
  }
}

/**
 * Batches each pointer's moves per display frame, as a browser delivers them: the last move of a frame is the event,
 * and the earlier ones ride on it as coalesced samples. Downs, lifts, and other events stay as they are.
 */
function coalesce(drafts: Draft[], frameHz: number): Draft[] {
  const frame = 1000 / frameHz;
  const out: (Draft | null)[] = [];
  const open = new Map<string, { at: number; frame: number }>();
  for (const e of drafts) {
    const key = `${e.pt ?? ''}${e.id ?? ''}`;
    if (e.type !== 'pointermove' || e.pt === undefined) {
      if (e.pt !== undefined) open.delete(key);
      out.push(e);
      continue;
    }
    const f = Math.floor(e.t / frame);
    const prev = open.get(key);
    const held = prev && prev.frame === f ? out[prev.at] : null;
    open.set(key, { at: out.length, frame: f });
    if (!held || held.bs !== e.bs) {
      out.push(e);
      continue;
    }
    // The batch is delivered with its last sample, after whatever other pointers sent in between.
    const sample: Coalesced = [
      held.t,
      held.x ?? 0,
      held.y ?? 0,
      held.p ?? 0,
      held.tx ?? 0,
      held.ty ?? 0,
      held.w ?? 1,
      held.h ?? 1,
    ];
    out[prev!.at] = null;
    out.push({ ...e, co: [...(held.co ?? []), sample] });
  }
  return out.filter((e): e is Draft => e !== null);
}

/**
 * Moves events within the same 16 ms frame into a random delivery order, as pen and touch arrive interleaved in a
 * batch. Timestamps stay; only `seq` changes. Each pointer's own events keep their order.
 */
export function reorderWithinFrames(s: Session, rand: Rand): Session {
  const frames = new Map<number, SessionEvent[]>();
  for (const e of s.events) {
    const k = Math.floor(e.t / 16);
    const list = frames.get(k) ?? [];
    list.push(e);
    frames.set(k, list);
  }
  const out: SessionEvent[] = [];
  for (const k of [...frames.keys()].sort((a, b) => a - b)) {
    const byPointer = new Map<string, SessionEvent[]>();
    for (const e of frames.get(k)!) {
      const key = `${e.pt ?? 'x'}${e.id ?? -1}`;
      byPointer.set(key, [...(byPointer.get(key) ?? []), e]);
    }
    const queues = [...byPointer.values()];
    while (queues.some((q) => q.length > 0)) {
      const live = queues.filter((q) => q.length > 0);
      out.push(live[Math.floor(rand() * live.length)].shift()!);
    }
  }
  return { ...s, events: out.map((e, seq) => ({ ...e, seq })) };
}
