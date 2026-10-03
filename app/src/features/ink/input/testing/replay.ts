// The replayer drives the shipped pipeline through a session in delivery order, ticking every 100 ms of session time.
// The pipeline runs the real palm filter, multi-tap detector, touch navigation, and stroke builders. A recording host
// notes what a page view would show: ink shown, committed, and taken back per contact, camera movement per contact
// after reverts, taps, menus, and gestures.

import { createInkPipeline } from '../pipeline';
import type { CameraOp, InkPipeline, PipelineHost, PointerRecord, TouchInk, TouchStrokePhase } from '../pipeline';
import type { DeviceProfile, LearnedState, PalmSettings, TouchPolicy } from '../palm/index';
import { tiltFromAngles } from '../samples';
import { createStrokeBuilder } from '../strokeBuilder';
import { GLIDE_FRICTION } from '../touchNav';
import { PENS } from '../../pens/palette';
import { PROFILES } from './profiles';
import type { Session, SessionEvent } from './session';

export interface ContactOutcome {
  readonly id: number;
  start: number;
  end: number;
  /** Provisional ink: points shown, when first shown, and when taken back. */
  shown: number;
  firstShown: number;
  retractedAt: number;
  committedAt: number;
  committedPoints: number;
  uncommitted: boolean;
  /** Camera movement this contact caused, in px, after reverts, and its largest value along the way. */
  camX: number;
  camY: number;
  zoom: number;
  peak: number;
  startedAt: number;
  tapAllowed: boolean;
  menuAllowed: boolean;
}

export interface ReplayResult {
  readonly contacts: Map<number, ContactOutcome>;
  readonly penSamples: number;
  readonly penSamplesExpected: number;
  readonly gestures: { readonly kind: 'undo' | 'redo'; readonly t: number }[];
  readonly policies: TouchPolicy[];
  readonly cssPxPerMm: number;
  readonly learned: LearnedState;
}

const outcome = (id: number, t: number): ContactOutcome => ({
  id,
  start: t,
  end: Number.NaN,
  shown: 0,
  firstShown: Number.NaN,
  retractedAt: Number.NaN,
  committedAt: Number.NaN,
  committedPoints: 0,
  uncommitted: false,
  camX: 0,
  camY: 0,
  zoom: 1,
  peak: 0,
  startedAt: Number.NaN,
  tapAllowed: false,
  menuAllowed: false,
});

/** A page view that records instead of drawing. */
class RecordingHost implements PipelineHost {
  now = 0;
  penSamples = 0;
  readonly contacts = new Map<number, ContactOutcome>();
  readonly gestures: { kind: 'undo' | 'redo'; t: number }[] = [];
  readonly policies: TouchPolicy[] = [];
  private strokeIds = 0;

  of(id: number): ContactOutcome {
    let c = this.contacts.get(id);
    if (!c) {
      c = outcome(id, this.now);
      this.contacts.set(id, c);
    }
    return c;
  }

  penSample(): void {
    this.penSamples++;
  }

  touchBuilder() {
    return createStrokeBuilder({
      tool: 'pen',
      width: 2,
      slot: PENS[0].slot,
      color: PENS[0].light,
      block: 'replay',
      newId: () => `r${++this.strokeIds}`,
      timeOrigin: 0,
    });
  }

  toPage(r: PointerRecord, out: { x: number; y: number }): void {
    out.x = r.x;
    out.y = r.y;
  }

  touchStroke(id: number, phase: TouchStrokePhase, ink: TouchInk): void {
    const c = this.of(id);
    if (phase === 'point' || phase === 'show') {
      c.shown = ink.builder.points.length;
      if (Number.isNaN(c.firstShown)) c.firstShown = this.now;
    } else if (phase === 'retract') {
      c.retractedAt = this.now;
    } else if (phase === 'commit') {
      c.committedAt = this.now;
      c.committedPoints = (ink.strokes ?? []).reduce((n, s) => n + s.points.length, 0);
    } else if (phase === 'uncommit') {
      c.uncommitted = true;
    }
  }

  camera(op: CameraOp, id: number, a: number, b: number, k: number): void {
    const c = this.of(id);
    if (op === 'panBy') {
      c.camX += a;
      c.camY += b;
    } else if (op === 'zoomAt') {
      c.zoom *= k;
    } else if (op === 'fling') {
      c.camX += a / (1 - GLIDE_FRICTION);
      c.camY += b / (1 - GLIDE_FRICTION);
    } else if (op === 'revert') {
      c.camX = c.camY = 0;
      c.zoom = 1;
    }
    c.peak = Math.max(c.peak, Math.hypot(c.camX, c.camY));
    if (op === 'panBy' && Number.isNaN(c.startedAt)) c.startedAt = this.now;
  }

  tap(id: number, allowed: boolean): void {
    this.of(id).tapAllowed = allowed;
  }

  contextMenu(id: number, allowed: boolean): void {
    if (allowed) this.of(id).menuAllowed = true;
  }

  gesture(kind: 'undo' | 'redo'): void {
    this.gestures.push({ kind, t: this.now });
  }

  touchPolicy(policy: TouchPolicy): void {
    this.policies.push(policy);
  }
}

const record = (): PointerRecord => ({
  type: 'down',
  id: 0,
  kind: 'pen',
  t: 0,
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  p: 0,
  tiltX: 0,
  tiltY: 0,
  buttons: 0,
  surface: 'page',
});

function fill(r: PointerRecord, e: SessionEvent, type: PointerRecord['type']): PointerRecord {
  r.type = type;
  r.id = e.id ?? 0;
  r.kind = e.pt ?? 'pen';
  r.t = e.t;
  r.x = e.x ?? 0;
  r.y = e.y ?? 0;
  r.w = e.w ?? 1;
  r.h = e.h ?? 1;
  r.p = e.p ?? 0;
  if (e.tx !== undefined || e.ty !== undefined || e.alt === undefined || e.az === undefined) {
    r.tiltX = e.tx ?? 0;
    r.tiltY = e.ty ?? 0;
  } else {
    const tilt = tiltFromAngles(e.alt, e.az);
    r.tiltX = tilt.tiltX;
    r.tiltY = tilt.tiltY;
  }
  r.buttons = e.bs ?? 0;
  r.surface = e.target === 'chrome' ? 'chrome' : 'page';
  return r;
}

const POINTER_TYPES: Partial<Record<SessionEvent['type'], PointerRecord['type']>> = {
  pointerdown: 'down',
  pointermove: 'move',
  pointerup: 'up',
  pointercancel: 'cancel',
};

/** Whether an event is a pen sample the page view passes to the active tool. */
const isPenSample = (e: SessionEvent) =>
  e.pt === 'pen' &&
  (e.type === 'pointerdown' || e.type === 'pointerup' || (e.type === 'pointermove' && (e.bs ?? 0) !== 0));

export interface ReplayOptions {
  readonly settings?: Partial<PalmSettings>;
  readonly profile?: Partial<DeviceProfile>;
  readonly learned?: LearnedState;
  /** How long to keep ticking after the last event, so held strokes resolve. */
  readonly tailMs?: number;
  /** Called after each event, for the lab overlay and for debugging a failing scenario. */
  readonly trace?: (event: SessionEvent, pipeline: InkPipeline) => void;
}

/** Replays a session through the shipped pipeline and records the outcome per contact. */
export function replaySession(session: Session, options: ReplayOptions = {}): ReplayResult {
  const host = new RecordingHost();
  const sim = PROFILES.find((p) => p.id === session.header.profile);
  const profile = options.profile ?? sim?.device ?? { pxPerMm: session.header.screen.cssPxPerMm };
  const learned = options.learned ?? session.header.learned;
  const pipeline = createInkPipeline(host, { ...session.header.settings, ...options.settings }, profile, learned);
  pipeline.filter.setViewport(session.header.screen.w, session.header.screen.h);
  const r = record();
  let clock = 0;
  let expected = 0;
  let tick = 100;
  const advance = (t: number) => {
    for (;;) {
      const next = Math.min(tick, pipeline.nextDue());
      if (next > t) return;
      if (next === tick) tick += 100;
      clock = Math.max(clock, next);
      host.now = Math.max(host.now, clock);
      pipeline.tick(clock);
    }
  };
  for (const e of session.events) {
    advance(e.t);
    host.now = Math.max(host.now, e.t);
    if (isPenSample(e)) expected += 1 + (e.co?.length ?? 0);
    deliver(pipeline, host, r, e);
    options.trace?.(e, pipeline);
  }
  const last = session.events.length > 0 ? session.events[session.events.length - 1].t : 0;
  advance(last + (options.tailMs ?? 3000));
  return {
    contacts: host.contacts,
    penSamples: host.penSamples,
    penSamplesExpected: expected,
    gestures: host.gestures,
    policies: host.policies,
    cssPxPerMm: session.header.screen.cssPxPerMm,
    learned: pipeline.learned(),
  };
}

function deliver(pipeline: InkPipeline, host: RecordingHost, r: PointerRecord, e: SessionEvent): void {
  const type = POINTER_TYPES[e.type];
  if (type) {
    if (e.pt === 'touch' && type === 'down') host.of(e.id ?? 0).start = e.t;
    for (const c of e.co ?? []) {
      fill(r, e, type);
      [r.t, r.x, r.y, r.p, r.tiltX, r.tiltY, r.w, r.h] = c;
      pipeline.handle(r);
    }
    pipeline.handle(fill(r, e, type));
    if (e.pt === 'touch' && (type === 'up' || type === 'cancel')) host.of(e.id ?? 0).end = e.t;
    return;
  }
  if (e.pt === 'pen' && (e.type === 'pointerleave' || e.type === 'pointerout') && e.target === 'root') {
    pipeline.handle(fill(r, e, 'leave'));
  } else if (e.type === 'lostpointercapture' && e.down) pipeline.system('penCaptureLost', e.t);
  else if (e.type === 'blur') pipeline.system('blur', e.t);
  else if (e.type === 'visibility' && e.hidden) pipeline.system('hidden', e.t);
  else if (e.type === 'pageswitch') pipeline.system('pageSwitch', e.t);
  else if (e.type === 'native' && e.kind) pipeline.filter.hint(e.kind, e.t, e.x ?? 0, e.y ?? 0);
  else if (e.type === 'tool') pipeline.setInkToolActive(e.on ?? false);
}
