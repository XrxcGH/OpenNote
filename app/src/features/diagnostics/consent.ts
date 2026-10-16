// The consent screen's rules and states. Crash reports are opt-in: nothing is saved until the person says yes,
// and a yes counts only for the wording they saw. These functions mirror crates/crashreport/src/consent.rs, and
// consent.test.ts checks that the wording version is the same on both sides. The screen is specified in
// docs/design/SCREENS.md (Crash reports). The functions here are pure, so the screen can keep its state in a
// reducer or in the app's store.

import type { Consent, ConsentPrompt } from './types';

/** The version of the consent wording. Raise it, in Rust and here, whenever a report holds anything new. */
export const WORDING_VERSION = 1;

/** A yes to the current wording, given at `now` (seconds since 1970). */
export function accepted(now: number): Consent {
  return { decision: 'accepted', wordingVersion: WORDING_VERSION, decidedUnix: now };
}

/** A no to the current wording, given at `now`. Turning crash reports off again later is also a no. */
export function declined(now: number): Consent {
  return { decision: 'declined', wordingVersion: WORDING_VERSION, decidedUnix: now };
}

/** Nothing decided yet. */
export const UNASKED: Consent = { decision: 'unasked', wordingVersion: 0, decidedUnix: null };

/** Whether the person said yes to the wording this version has. A yes to older wording is not enough. */
export function savingAllowed(consent: Consent): boolean {
  return consent.decision === 'accepted' && consent.wordingVersion === WORDING_VERSION;
}

/**
 * Whether to show the consent screen. A person who was never asked is asked once. One who decided under older
 * wording is asked again, and the screen says what changed. Everyone else is left alone, so a no is never nagged.
 */
export function prompt(consent: Consent): ConsentPrompt {
  if (consent.decision === 'unasked') return 'first';
  return consent.wordingVersion < WORDING_VERSION ? 'reworded' : 'none';
}

/** The consent screen's state while it is open. */
export interface ConsentFlow {
  /** Why it opened. 'reworded' adds a line that says the answer is being asked again. */
  readonly reason: 'first' | 'reworded' | 'settings';
  /** Whether the example report is showing. */
  readonly showingExample: boolean;
  /** Whether the person has finished. The screen then closes. */
  readonly closed: boolean;
  /** The choice to store, or null when nothing changes. */
  readonly result: Consent | null;
}

export type ConsentEvent =
  | { type: 'toggleExample' }
  | { type: 'turnOn'; now: number }
  | { type: 'keepOff'; now: number }
  /**
   * Escape or closing the dialog. When the screen opened by itself, that is a no, so it does not return. When
   * the person opened it from Settings, it changes nothing.
   */
  | { type: 'dismiss'; now: number };

/** Opens the screen. `reason` comes from `prompt`, or is 'settings' when the person opened it themselves. */
export function openConsent(reason: ConsentFlow['reason']): ConsentFlow {
  return { reason, showingExample: false, closed: false, result: null };
}

/** The next state. Once the screen is closed, nothing changes it. */
export function reduceConsent(flow: ConsentFlow, event: ConsentEvent): ConsentFlow {
  if (flow.closed) return flow;
  switch (event.type) {
    case 'toggleExample':
      return { ...flow, showingExample: !flow.showingExample };
    case 'turnOn':
      return { ...flow, closed: true, result: accepted(event.now) };
    case 'keepOff':
      return { ...flow, closed: true, result: declined(event.now) };
    case 'dismiss':
      return { ...flow, closed: true, result: flow.reason === 'settings' ? null : declined(event.now) };
  }
}
