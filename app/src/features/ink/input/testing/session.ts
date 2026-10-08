// The labeled session format (`tests/fixtures/palm/**/*.session.jsonl`, schema in `session.schema.json`). One JSON
// object per line: a header, then events in delivery order, labels that say what each contact was and what the
// person meant, and reviewer expectations. Recordings and generated sessions share it, so one replayer measures both.

import type { LearnedState, PalmSettings } from '../palm/index';

export const SESSION_FORMAT = 'opennote-palm-session';
export const SESSION_VERSION = 1;
/** Fixtures larger than this are gzipped; none may exceed 1 MB. */
export const GZIP_OVER_BYTES = 256 * 1024;
export const MAX_FIXTURE_BYTES = 1024 * 1024;

export type HoverRange = 'none' | 'short' | 'long';
export type TiltMode = 'none' | 'degrees' | 'angles';
export type SizeReport = 'real' | 'quantized' | 'constant' | 'none';
export type Grip = 'tripod' | 'hooked' | 'overwriter' | 'fist';
export type Posture = 'desk' | 'lap' | 'handheld';

export interface SessionHeader {
  readonly format: typeof SESSION_FORMAT;
  readonly version: number;
  readonly device: {
    readonly os: string;
    readonly model: string;
    readonly digitizer: string;
    readonly penFamily: string;
  };
  /** A profile id from `profiles.ts`. */
  readonly profile: string;
  readonly capabilities: {
    readonly hover: HoverRange;
    readonly pressureLevels: number;
    readonly tiltMode: TiltMode;
    readonly sizeMode: SizeReport;
    readonly rateHz: number;
  };
  readonly screen: {
    readonly dpr: number;
    readonly cssPxPerMm: number;
    readonly refreshHz: number;
    readonly w: number;
    readonly h: number;
  };
  readonly webview: string;
  readonly handedness: 'right' | 'left';
  readonly grip: Grip;
  readonly posture: Posture;
  readonly settings: Partial<PalmSettings>;
  /** The device state the filter started from, such as `penSeen` on a device that has used a pen before. */
  readonly learned?: LearnedState;
  readonly task: string;
  readonly consent: boolean;
}

export type EventType =
  | 'pointerover'
  | 'pointerenter'
  | 'pointerdown'
  | 'pointermove'
  | 'pointerrawupdate'
  | 'pointerup'
  | 'pointercancel'
  | 'pointerout'
  | 'pointerleave'
  | 'gotpointercapture'
  | 'lostpointercapture'
  | 'blur'
  | 'focus'
  | 'visibility'
  | 'pageswitch'
  | 'native'
  | 'tool';

export const EVENT_TYPES: readonly EventType[] = [
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
  'lostpointercapture',
  'blur',
  'focus',
  'visibility',
  'pageswitch',
  'native',
  'tool',
];

/** A coalesced sample: [t, x, y, pressure, tiltX, tiltY, width, height]. */
export type Coalesced = readonly [number, number, number, number, number, number, number, number];

/** One event. `seq` is delivery order and `t` the event's `timeStamp`; positions are client CSS px. */
export interface SessionEvent {
  readonly seq: number;
  readonly t: number;
  readonly type: EventType;
  readonly id?: number;
  /** Pointer type. */
  readonly pt?: 'pen' | 'touch' | 'mouse';
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
  readonly p?: number;
  readonly tx?: number;
  readonly ty?: number;
  readonly alt?: number;
  readonly az?: number;
  readonly twist?: number;
  /** `button` and `buttons`. */
  readonly b?: number;
  readonly bs?: number;
  readonly co?: readonly Coalesced[];
  readonly pr?: readonly Coalesced[];
  /** `page`, `chrome`, or `root` (the document root, for a pen leaving range). */
  readonly target?: 'page' | 'chrome' | 'root';
  /** `visibility`: hidden or visible. `tool`: an ink tool is active. `native`: the hint kind. */
  readonly hidden?: boolean;
  readonly on?: boolean;
  readonly kind?: 'palm' | 'confident';
  /** `lostpointercapture` while the pen was still down. */
  readonly down?: boolean;
}

export type LabelClass =
  | 'pen'
  | 'pen-eraser'
  | 'finger'
  | 'thumb'
  | 'palm'
  | 'wrist'
  | 'knuckle'
  | 'pinky'
  | 'grip-thumb'
  | 'sleeve'
  | 'other';
export type Intent = 'ink' | 'erase' | 'pan' | 'zoom' | 'scroll' | 'tap' | 'gesture' | 'none';

export const LABEL_CLASSES: readonly LabelClass[] = [
  'pen',
  'pen-eraser',
  'finger',
  'thumb',
  'palm',
  'wrist',
  'knuckle',
  'pinky',
  'grip-thumb',
  'sleeve',
  'other',
];
export const INTENTS: readonly Intent[] = ['ink', 'erase', 'pan', 'zoom', 'scroll', 'tap', 'gesture', 'none'];

/** What a contact was and meant between two times. A contact may carry several, such as a fingertip that turns palm. */
export interface Label {
  readonly type: 'label';
  readonly id: number;
  readonly from: number;
  readonly to: number;
  readonly cls: LabelClass;
  readonly intent: Intent;
  /** A known limit (`LIMITS`): no signal a page can see tells this contact apart. */
  readonly limit?: string;
}

export interface Expect {
  readonly type: 'expect';
  readonly t: number;
  readonly what: 'stray-mark' | 'missed-stroke' | 'stray-scroll';
  readonly note: string;
}

export interface Session {
  readonly header: SessionHeader;
  readonly events: readonly SessionEvent[];
  readonly labels: readonly Label[];
  readonly expects: readonly Expect[];
}

export function serializeSession(s: Session): string {
  const lines = [JSON.stringify(s.header)];
  for (const e of s.events) lines.push(JSON.stringify(e));
  for (const l of s.labels) lines.push(JSON.stringify(l));
  for (const x of s.expects) lines.push(JSON.stringify(x));
  return `${lines.join('\n')}\n`;
}

/** Parses a session; throws with the line number on a line that is not JSON. Run `validateSession` on the result. */
export function parseSession(text: string): Session {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const parsed = lines.map((line, i) => {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(`line ${i + 1} is not JSON`);
    }
  });
  const [header, ...rest] = parsed;
  return {
    header: header as unknown as SessionHeader,
    events: rest.filter((r) => typeof r.seq === 'number') as unknown as SessionEvent[],
    labels: rest.filter((r) => r.type === 'label') as unknown as Label[],
    expects: rest.filter((r) => r.type === 'expect') as unknown as Expect[],
  };
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function headerErrors(h: SessionHeader): string[] {
  const errors: string[] = [];
  if (h?.format !== SESSION_FORMAT) errors.push('header: format');
  if (h?.version !== SESSION_VERSION) errors.push('header: version');
  if (!h?.device || typeof h.device.os !== 'string') errors.push('header: device');
  if (typeof h?.profile !== 'string') errors.push('header: profile');
  if (!num(h?.screen?.cssPxPerMm) || h.screen.cssPxPerMm <= 0) errors.push('header: screen.cssPxPerMm');
  if (h?.handedness !== 'right' && h?.handedness !== 'left') errors.push('header: handedness');
  if (h?.consent !== true) errors.push('header: consent');
  return errors;
}

/** Every rule of the schema that matters to the replayer. Returns the problems found, or an empty list. */
export function validateSession(s: Session): string[] {
  const errors = headerErrors(s.header);
  let seq = -1;
  for (const e of s.events) {
    if (!EVENT_TYPES.includes(e.type)) errors.push(`event ${e.seq}: type ${String(e.type)}`);
    if (e.seq <= seq) errors.push(`event ${e.seq}: seq out of order`);
    if (!num(e.t)) errors.push(`event ${e.seq}: t`);
    if (e.type.startsWith('pointer') && (!num(e.id) || !num(e.x) || !num(e.y) || !e.pt)) {
      errors.push(`event ${e.seq}: pointer fields`);
    }
    seq = e.seq;
  }
  for (const l of s.labels) {
    if (!LABEL_CLASSES.includes(l.cls) || !INTENTS.includes(l.intent) || !(l.from <= l.to)) {
      errors.push(`label ${l.id}: fields`);
    }
  }
  return errors;
}

/** The labels of a contact; the intent that applies at its start decides what it should have done. */
export function labelOf(s: Session, id: number): Label | undefined {
  let best: Label | undefined;
  for (const l of s.labels) if (l.id === id && (!best || l.from < best.from)) best = l;
  return best;
}
