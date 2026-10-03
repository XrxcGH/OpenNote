// Palm rejection (architecture 5.5): while a pen is near the screen, touch never draws. Windows and Surface firmware
// drop most palm contacts before they reach the app. This state machine handles the rest. It has no timers and no
// events of its own: the page view calls `pen` for every pen event, hover included, and `touchDown`, `touchMove`, and
// `touchEnd` for touch. Every call carries the time, so a recorded session replays the same way every time.

/** Away: no pen. Hovering: in range. Down: touching. Grace: just left range, for a short time. */
export type PenState = 'away' | 'hovering' | 'down' | 'grace';

/**
 * What a pen event is. `hover` is any pen event with no contact, and `move` is a move with contact. `lost` stands
 * for a window losing focus, a page switch, or a lost pen capture. All three count as the pen leaving.
 */
export type PenSignal = 'hover' | 'down' | 'move' | 'up' | 'cancel' | 'leave' | 'lost';

/** Page surfaces get the rules. Controls outside the page keep working for every finger. */
export type Surface = 'page' | 'chrome';

/**
 * What a touch contact does. `pass` leaves it to the browser, such as a native scroll. `ignore` swallows it, with
 * no ink, pan, tap, or long press. `draw` draws a touch stroke. `pan` is half of a two-finger pan and zoom.
 */
export type TouchRole = 'pass' | 'ignore' | 'draw' | 'pan';

export interface PalmSettings {
  /** How long the pen counts as near after it leaves range, 300 to 2,000 ms. */
  readonly graceMs: number;
  /** How long a hovering pen may send no event before it counts as gone. */
  readonly watchdogMs: number;
  /** Two contacts that start this close together are a two-finger gesture. */
  readonly panWindowMs: number;
  /** A contact wider or taller than this, in CSS pixels, is a palm. */
  readonly palmSize: number;
  /** "Draw with touch". */
  readonly drawWithTouch: boolean;
  /** "Scroll with two fingers while the pen is near". */
  readonly twoFingerPan: boolean;
}

export const DEFAULT_PALM_SETTINGS: PalmSettings = {
  graceMs: 500,
  watchdogMs: 2000,
  panWindowMs: 150,
  palmSize: 76,
  drawWithTouch: false,
  twoFingerPan: true,
};

export const MIN_GRACE_MS = 300;
export const MAX_GRACE_MS = 2000;

export interface TouchContact {
  readonly id: number;
  /** Milliseconds on the page's clock. */
  readonly time: number;
  /** The contact's size in CSS pixels. A digitizer that reports none gives 1 by 1. */
  readonly width: number;
  readonly height: number;
  readonly surface: Surface;
}

export interface TouchDecision {
  /** What this contact does. */
  readonly role: TouchRole;
  /** Contacts whose role changed because of this one, such as a first finger that became half of a pan. */
  readonly changed: readonly number[];
  /** True when a touch stroke in progress must be dropped, because a second finger turned it into a pan. */
  readonly cancelDraw: boolean;
}

export interface HeldStroke {
  /** When the contact began. */
  readonly started: number;
  /** When the stroke may commit if no pen has come near. */
  readonly until: number;
}

export interface TouchEnd {
  readonly role: TouchRole;
  /** True when the stroke must be dropped now: Windows canceled the contact because it read it as a palm. */
  readonly drop: boolean;
  /** For a touch stroke that ended normally: hold it, then ask `heldFate`. */
  readonly hold: HeldStroke | null;
}

export type HeldFate = 'wait' | 'commit' | 'drop';

export interface PalmFilter {
  configure(settings: Partial<PalmSettings>): void;
  /** Whether an ink tool is active, which keeps a digitizer without hover in the near state. */
  setInkToolActive(active: boolean): void;
  /** Feeds a pen event. Returns the ids of touch strokes that must be dropped because the pen came near. */
  pen(signal: PenSignal, time: number): readonly number[];
  penState(time: number): PenState;
  /** True when the page should block native touch: `data-pen-near` is set, and `touch-action` is none. */
  penNear(time: number): boolean;
  touchDown(contact: TouchContact): TouchDecision;
  touchMove(id: number): TouchRole;
  touchEnd(id: number, time: number, canceled: boolean): TouchEnd;
  /** What to do with a held touch stroke. A pen event since it began drops it. */
  heldFate(hold: HeldStroke, now: number): HeldFate;
  /** Forgets every contact, for a page switch. */
  reset(): void;
}

interface Contact {
  readonly time: number;
  readonly palm: boolean;
  readonly surface: Surface;
  role: TouchRole;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** True for a contact larger than a fingertip. A size of 1 by 1 means the digitizer reports none. */
function isPalm(contact: TouchContact, palmSize: number): boolean {
  if (contact.width <= 1 && contact.height <= 1) return false;
  return contact.width > palmSize || contact.height > palmSize;
}

const NONE: TouchDecision = { role: 'pass', changed: [], cancelDraw: false };

class PalmMachine implements PalmFilter {
  private settings: PalmSettings;
  private state: PenState = 'away';
  private lastPenAt = Number.NEGATIVE_INFINITY;
  private graceStart = 0;
  private hoverSeen = false;
  private sticky = false;
  private inkToolActive = false;
  private readonly contacts = new Map<number, Contact>();

  constructor(initial: Partial<PalmSettings>) {
    this.settings = { ...DEFAULT_PALM_SETTINGS, ...initial };
  }

  configure(next: Partial<PalmSettings>): void {
    this.settings = { ...this.settings, ...next };
  }

  setInkToolActive(active: boolean): void {
    this.inkToolActive = active;
  }

  pen(signal: PenSignal, time: number): readonly number[] {
    this.advance(time);
    const wasNear = this.state !== 'away';
    this.applySignal(signal, time);
    this.lastPenAt = time;
    return wasNear ? [] : this.dropDrawing();
  }

  penState(time: number): PenState {
    this.advance(time);
    return this.state;
  }

  penNear(time: number): boolean {
    this.advance(time);
    return this.state !== 'away' || (this.sticky && this.inkToolActive);
  }

  touchDown(c: TouchContact): TouchDecision {
    const palm = isPalm(c, this.settings.palmSize);
    const contact: Contact = { time: c.time, palm, surface: c.surface, role: 'pass' };
    this.contacts.set(c.id, contact);
    if (c.surface === 'chrome') return NONE;
    const decision = this.penNear(c.time) ? this.decideNear(c.id, contact) : this.decideFree(c.id, contact);
    contact.role = decision.role;
    return decision;
  }

  touchMove(id: number): TouchRole {
    return this.contacts.get(id)?.role ?? 'pass';
  }

  touchEnd(id: number, time: number, canceled: boolean): TouchEnd {
    const contact = this.contacts.get(id);
    this.contacts.delete(id);
    if (!contact) return { role: 'pass', drop: false, hold: null };
    this.settlePan();
    const drawing = contact.role === 'draw';
    const hold = drawing && !canceled ? { started: contact.time, until: time + this.graceMs() } : null;
    return { role: contact.role, drop: drawing && canceled, hold };
  }

  heldFate(hold: HeldStroke, now: number): HeldFate {
    if (this.lastPenAt >= hold.started) return 'drop';
    return now >= hold.until ? 'commit' : 'wait';
  }

  reset(): void {
    this.contacts.clear();
  }

  private graceMs(): number {
    return clamp(this.settings.graceMs, MIN_GRACE_MS, MAX_GRACE_MS);
  }

  /** Settles the timers that ran out since the last call. */
  private advance(now: number): void {
    if (this.state === 'hovering' && now - this.lastPenAt >= this.settings.watchdogMs) {
      this.state = 'grace';
      this.graceStart = this.lastPenAt + this.settings.watchdogMs;
    }
    if (this.state === 'grace' && now - this.graceStart >= this.graceMs()) this.state = 'away';
  }

  private applySignal(signal: PenSignal, time: number): void {
    switch (signal) {
      case 'hover':
        this.hoverSeen = true;
        this.state = 'hovering';
        break;
      case 'down':
        if (!this.hoverSeen && this.state === 'away') this.sticky = true;
        this.state = 'down';
        break;
      case 'move':
        this.state = 'down';
        break;
      case 'up':
      case 'cancel':
        this.leaveRange(this.hoverSeen ? 'hovering' : 'grace', time);
        break;
      case 'leave':
        if (this.state !== 'down') this.leaveRange('grace', time);
        break;
      case 'lost':
        this.leaveRange('grace', time);
        break;
    }
  }

  private leaveRange(next: PenState, time: number): void {
    this.state = next;
    this.graceStart = time;
  }

  private pageContacts(except: number): [number, Contact][] {
    return [...this.contacts.entries()].filter(([id, c]) => id !== except && c.surface === 'page');
  }

  private setRole(id: number, role: TouchRole, changed: number[]): void {
    const contact = this.contacts.get(id);
    if (contact && contact.role !== role) {
      contact.role = role;
      changed.push(id);
    }
  }

  private startsTogether(first: Contact, second: Contact): boolean {
    return !first.palm && !second.palm && second.time - first.time <= this.settings.panWindowMs;
  }

  /** Roles for a new page contact while the pen is near: one finger is ignored, and two that start together pan. */
  private decideNear(id: number, contact: Contact): TouchDecision {
    const others = this.pageContacts(id);
    const changed: number[] = [];
    if (others.length === 1 && this.settings.twoFingerPan && this.startsTogether(others[0][1], contact)) {
      this.setRole(others[0][0], 'pan', changed);
      return { role: 'pan', changed, cancelDraw: false };
    }
    for (const [other] of others) this.setRole(other, 'ignore', changed);
    return { role: 'ignore', changed, cancelDraw: false };
  }

  /** Roles for a new page contact while the pen is away. Only "Draw with touch" takes fingers from the browser. */
  private decideFree(id: number, contact: Contact): TouchDecision {
    if (!this.settings.drawWithTouch) return NONE;
    const others = this.pageContacts(id);
    const changed: number[] = [];
    if (others.length === 0) return { role: contact.palm ? 'ignore' : 'draw', changed, cancelDraw: false };
    const wasDrawing = others.some(([, c]) => c.role === 'draw');
    if (others.length === 1 && this.startsTogether(others[0][1], contact)) {
      this.setRole(others[0][0], 'pan', changed);
      return { role: 'pan', changed, cancelDraw: wasDrawing };
    }
    if (others.length >= 2) for (const [other] of others) this.setRole(other, 'ignore', changed);
    return { role: 'ignore', changed, cancelDraw: others.length >= 2 && wasDrawing };
  }

  /** Touch strokes in progress stop when a pen comes near, and their contacts are ignored from then on. */
  private dropDrawing(): number[] {
    const dropped: number[] = [];
    for (const [id, contact] of this.contacts) {
      if (contact.role === 'draw') {
        contact.role = 'ignore';
        dropped.push(id);
      }
    }
    return dropped;
  }

  /** One finger left over from a pan has nothing to pan with. */
  private settlePan(): void {
    const pans = [...this.contacts.values()].filter((c) => c.role === 'pan');
    if (pans.length === 1) pans[0].role = 'ignore';
  }
}

export function createPalmFilter(initial: Partial<PalmSettings> = {}): PalmFilter {
  return new PalmMachine(initial);
}
