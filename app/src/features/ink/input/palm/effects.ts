// Roles, effects, and the effect queue. Each call to the filter empties the queue first, then records one entry per
// contact it changed, so the caller drains the queue after every call. The queue is typed arrays, so no event
// allocates.

import * as thresholds from './thresholds';

/** A plain copy, so hot loops read fields rather than module bindings. */
const { MAX_EFFECTS } = thresholds;

/**
 * What a touch contact does. Pass: native, on surfaces the filter does not manage. Ignore: nothing at all. Draw:
 * provisional touch ink. Shadow: a stroke built but not shown, promoted if the drawing contact proves to be a palm.
 * Scroll: one-finger scroll, pending until it passes slop and its gate. Nav: half of a two-finger pan and pinch.
 * Pend: half of a pending pair in finger drawing: a stroke built but not shown until the pair resolves into a pan or
 * pinch (Nav, its ink retracted), a stroke (Draw, promoted with its whole path), or nothing (Ignore, retracted).
 */
export const Role = { Pass: 0, Ignore: 1, Draw: 2, Shadow: 3, Scroll: 4, Nav: 5, Pend: 6 } as const;
export type Role = (typeof Role)[keyof typeof Role];
/** The same type under a name that does not clash with a local copy of the values. */
export type RoleCode = Role;

export const ROLE_NAMES: readonly string[] = ['pass', 'ignore', 'draw', 'shadow', 'scroll', 'nav', 'pend'];

/**
 * What the page view must do for a contact. Retract: remove its provisional ink. Revert: restore the camera it
 * snapshotted at down. SuppressTap: swallow its click, long press, and multi-tap. Commit: store its held stroke.
 * Uncommit: take back a stroke committed just before a pen arrived. Start: its scroll or pan starts moving the camera.
 * Promote: show its stroke with its whole path, once it may be seen. Hold: its stroke ended without a lift (blur, page
 * switch, or a lost end) and waits for a Commit or a Retract.
 */
export const Fx = {
  Retract: 1,
  Revert: 2,
  SuppressTap: 4,
  Commit: 8,
  Uncommit: 16,
  Start: 32,
  Promote: 64,
  Hold: 128,
} as const;

/**
 * Bits `touchEnd` returns. TapAllowed: the lift may click. Held: the stroke waits for a Commit or a Retract. Hidden:
 * the held stroke stays hidden until it commits: a dot while a pen is in use, or on a pen device without contact
 * sizes, which a palm bounce looks like.
 */
export const End = { TapAllowed: 1, Held: 2, Hidden: 4 } as const;

export interface Effects {
  count: number;
  readonly id: Int32Array;
  readonly role: Uint8Array;
  readonly fx: Uint8Array;
  readonly why: Uint32Array;
}

export class EffectQueue implements Effects {
  count = 0;
  readonly id = new Int32Array(MAX_EFFECTS);
  readonly role = new Uint8Array(MAX_EFFECTS);
  readonly fx = new Uint8Array(MAX_EFFECTS);
  readonly why = new Uint32Array(MAX_EFFECTS);

  /** Records a role and effects for a contact, merged with an entry for the same contact from this call. */
  push(id: number, role: Role, fx: number, why: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.id[i] === id) {
        this.role[i] = role;
        this.fx[i] |= fx;
        this.why[i] = why;
        return;
      }
    }
    if (this.count === MAX_EFFECTS) return;
    const i = this.count++;
    this.id[i] = id;
    this.role[i] = role;
    this.fx[i] = fx;
    this.why[i] = why;
  }
}
