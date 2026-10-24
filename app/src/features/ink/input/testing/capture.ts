// The capture core of the Palm lab (palm README, "Measurement"): records real multi-pointer sessions to the labeled
// session format, labels them from the prompted task, and probes what the device reports. Pure logic: the lab page
// passes plain objects shaped like PointerEvent, so this runs in every WebView and in Node tests.

import { SESSION_FORMAT, SESSION_VERSION } from './session';
import type { Coalesced, Expect, Label, LabelClass, Intent, Session, SessionEvent, SessionHeader } from './session';

/** The fields of a PointerEvent the recorder reads. */
export interface PointerEventLike {
  readonly type: string;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly timeStamp: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly width?: number;
  readonly height?: number;
  readonly pressure?: number;
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly altitudeAngle?: number;
  readonly azimuthAngle?: number;
  readonly twist?: number;
  readonly button?: number;
  readonly buttons?: number;
  getCoalescedEvents?(): readonly PointerEventLike[];
  getPredictedEvents?(): readonly PointerEventLike[];
}

const POINTER_TYPES = new Set([
  'pointerover',
  'pointerenter',
  'pointerdown',
  'pointermove',
  'pointerrawupdate',
  'pointerup',
  'pointercancel',
  'pointerout',
  'pointerleave',
  'gotpointercapture',
]);

const r2 = (v: number) => Math.round(v * 100) / 100;

function sample(e: PointerEventLike): Coalesced {
  return [
    r2(e.timeStamp),
    r2(e.clientX),
    r2(e.clientY),
    r2(e.pressure ?? 0),
    e.tiltX ?? 0,
    e.tiltY ?? 0,
    r2(e.width ?? 1),
    r2(e.height ?? 1),
  ];
}

export interface SessionRecorder {
  /** Records a pointer event on the page, a control, or the document root. */
  pointer(e: PointerEventLike, target: 'page' | 'chrome' | 'root'): void;
  lostCapture(pointerId: number, t: number, penDown: boolean): void;
  blur(t: number): void;
  focus(t: number): void;
  visibility(hidden: boolean, t: number): void;
  pageSwitch(t: number): void;
  native(kind: 'palm' | 'confident', t: number, x: number, y: number): void;
  tool(on: boolean, t: number): void;
  label(label: Omit<Label, 'type'>): void;
  expect(note: Omit<Expect, 'type'>): void;
  finish(): Session;
}

class Recorder implements SessionRecorder {
  private readonly events: SessionEvent[] = [];
  private readonly labels: Label[] = [];
  private readonly expects: Expect[] = [];

  constructor(private readonly header: SessionHeader) {}

  private push(e: Omit<SessionEvent, 'seq'>): void {
    this.events.push({ seq: this.events.length, ...e } as SessionEvent);
  }

  pointer(e: PointerEventLike, target: 'page' | 'chrome' | 'root'): void {
    if (!POINTER_TYPES.has(e.type)) return;
    const pt = e.pointerType === 'pen' || e.pointerType === 'touch' ? e.pointerType : 'mouse';
    const co = e.type === 'pointermove' ? e.getCoalescedEvents?.() : undefined;
    const pr = e.type === 'pointermove' ? e.getPredictedEvents?.() : undefined;
    const coalesced = co && co.length > 1 ? co.slice(0, -1).map(sample) : undefined;
    this.push({
      t: r2(e.timeStamp),
      type: e.type as SessionEvent['type'],
      id: e.pointerId,
      pt,
      x: r2(e.clientX),
      y: r2(e.clientY),
      w: r2(e.width ?? 1),
      h: r2(e.height ?? 1),
      p: r2(e.pressure ?? 0),
      tx: e.tiltX,
      ty: e.tiltY,
      alt: e.altitudeAngle,
      az: e.azimuthAngle,
      twist: e.twist,
      b: e.button,
      bs: e.buttons,
      co: coalesced,
      pr: pr && pr.length > 0 ? pr.map(sample) : undefined,
      target,
    });
  }

  lostCapture(pointerId: number, t: number, penDown: boolean): void {
    this.push({ t, type: 'lostpointercapture', id: pointerId, down: penDown });
  }

  blur(t: number): void {
    this.push({ t, type: 'blur' });
  }

  focus(t: number): void {
    this.push({ t, type: 'focus' });
  }

  visibility(hidden: boolean, t: number): void {
    this.push({ t, type: 'visibility', hidden });
  }

  pageSwitch(t: number): void {
    this.push({ t, type: 'pageswitch' });
  }

  native(kind: 'palm' | 'confident', t: number, x: number, y: number): void {
    this.push({ t, type: 'native', kind, x, y });
  }

  tool(on: boolean, t: number): void {
    this.push({ t, type: 'tool', on });
  }

  label(label: Omit<Label, 'type'>): void {
    this.labels.push({ type: 'label', ...label });
  }

  expect(note: Omit<Expect, 'type'>): void {
    this.expects.push({ type: 'expect', ...note });
  }

  finish(): Session {
    return { header: this.header, events: [...this.events], labels: [...this.labels], expects: [...this.expects] };
  }
}

export function createSessionRecorder(header: Omit<SessionHeader, 'format' | 'version'>): SessionRecorder {
  return new Recorder({ format: SESSION_FORMAT, version: SESSION_VERSION, ...header });
}

/** Prompted Palm lab tasks, and what each touch contact in them is meant to be, so labels come prefilled. */
export const TASKS: Readonly<
  Record<string, { readonly touch: LabelClass; readonly intent: Intent; readonly prompt: string }>
> = {
  'write-resting': {
    touch: 'palm',
    intent: 'none',
    prompt: 'Write the sentence with your hand resting on the screen.',
  },
  'palm-then-pen': {
    touch: 'palm',
    intent: 'none',
    prompt: 'Rest your hand first, then bring the pen down and write.',
  },
  'lift-between-lines': {
    touch: 'palm',
    intent: 'none',
    prompt: 'Write three lines, lifting the pen out of range between them.',
  },
  'pinch-while-hover': {
    touch: 'finger',
    intent: 'zoom',
    prompt: 'Hold the pen just above the screen and pinch with the other hand.',
  },
  'scroll-other-hand': {
    touch: 'finger',
    intent: 'scroll',
    prompt: 'Hold the pen and scroll with one finger of the other hand.',
  },
  'finger-draw': { touch: 'finger', intent: 'ink', prompt: 'Draw the shapes with one finger.' },
  'knuckle-tap': {
    touch: 'knuckle',
    intent: 'none',
    prompt: 'Write, tapping the screen with your knuckles between words.',
  },
  'hold-edge': {
    touch: 'grip-thumb',
    intent: 'none',
    prompt: 'Hold the tablet by its edge with your thumb on the screen and write.',
  },
};

/** Labels for a session from its task: every pen contact is ink, and every touch contact what the task says. */
export function autoLabel(session: Session): Label[] {
  const task = TASKS[session.header.task];
  const open = new Map<string, { id: number; pt: string; from: number; to: number }>();
  const spans: { id: number; pt: string; from: number; to: number }[] = [];
  for (const e of session.events) {
    if (e.id === undefined || (e.pt !== 'pen' && e.pt !== 'touch')) continue;
    const key = `${e.pt}${e.id}`;
    if (e.type === 'pointerdown') open.set(key, { id: e.id, pt: e.pt, from: e.t, to: e.t });
    const span = open.get(key);
    if (!span) continue;
    span.to = e.t;
    if (e.type === 'pointerup' || e.type === 'pointercancel') {
      spans.push(span);
      open.delete(key);
    }
  }
  spans.push(...open.values());
  const labels: Label[] = [];
  for (const s of spans) {
    if (s.pt === 'pen') labels.push({ type: 'label', id: s.id, from: s.from, to: s.to, cls: 'pen', intent: 'ink' });
    else if (task)
      labels.push({ type: 'label', id: s.id, from: s.from, to: s.to, cls: task.touch, intent: task.intent });
  }
  return labels;
}

/** What a recording shows the device reports, to suggest a profile and the size mode. */
export function probeCapabilities(session: Session): SessionHeader['capabilities'] {
  const pen = session.events.filter((e) => e.pt === 'pen');
  const hover = pen.some((e) => e.type === 'pointermove' && (e.bs ?? 0) === 0);
  const pressures = new Set(pen.filter((e) => (e.bs ?? 0) !== 0).map((e) => e.p));
  const touches = session.events.filter((e) => e.pt === 'touch' && e.type === 'pointerdown');
  const sizes = new Set(touches.map((e) => `${e.w}x${e.h}`));
  const sizeMode = touches.every((e) => (e.w ?? 1) <= 1 && (e.h ?? 1) <= 1)
    ? 'none'
    : sizes.size === 1 && touches.length >= 8
      ? 'constant'
      : 'real';
  const moves = pen.filter((e) => e.type === 'pointermove' && (e.bs ?? 0) !== 0);
  const span = moves.length > 1 ? moves[moves.length - 1].t - moves[0].t : 0;
  const samples = moves.reduce((n, e) => n + 1 + (e.co?.length ?? 0), 0);
  return {
    hover: hover ? 'short' : 'none',
    pressureLevels: pressures.size > 2 ? 4096 : 0,
    tiltMode: pen.some((e) => (e.tx ?? 0) !== 0 || (e.ty ?? 0) !== 0)
      ? 'degrees'
      : pen.some((e) => e.az !== undefined)
        ? 'angles'
        : 'none',
    sizeMode,
    rateHz: span > 0 ? Math.round((samples * 1000) / span) : 0,
  };
}
