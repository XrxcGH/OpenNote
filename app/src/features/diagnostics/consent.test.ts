import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  UNASKED,
  WORDING_VERSION,
  accepted,
  declined,
  openConsent,
  prompt,
  reduceConsent,
  savingAllowed,
} from './consent';
import type { Consent } from './types';

const NOW = 1_790_000_000;

describe('what the person decided', () => {
  it('allows nothing before they decide', () => {
    expect(UNASKED).toEqual({ decision: 'unasked', wordingVersion: 0, decidedUnix: null });
    expect(savingAllowed(UNASKED)).toBe(false);
    expect(prompt(UNASKED)).toBe('first');
  });

  it('allows saving after a yes, and does not ask again', () => {
    const yes = accepted(NOW);
    expect(yes).toEqual({ decision: 'accepted', wordingVersion: WORDING_VERSION, decidedUnix: NOW });
    expect(savingAllowed(yes)).toBe(true);
    expect(prompt(yes)).toBe('none');
  });

  it('remembers a no, and does not nag', () => {
    const no = declined(NOW);
    expect(savingAllowed(no)).toBe(false);
    expect(prompt(no)).toBe('none');
  });

  it('stops counting a yes to older wording, and asks again', () => {
    const old: Consent = { decision: 'accepted', wordingVersion: WORDING_VERSION - 1, decidedUnix: 1 };
    expect(savingAllowed(old)).toBe(false);
    expect(prompt(old)).toBe('reworded');
    expect(prompt({ ...old, decision: 'declined' })).toBe('reworded');
  });

  it('does not trust a yes from a newer version either', () => {
    const newer: Consent = { decision: 'accepted', wordingVersion: WORDING_VERSION + 1, decidedUnix: 1 };
    expect(savingAllowed(newer)).toBe(false);
    expect(prompt(newer)).toBe('none');
  });
});

describe('the consent screen', () => {
  it('opens with the example hidden and toggles it', () => {
    let flow = openConsent('first');
    expect(flow).toEqual({ reason: 'first', showingExample: false, closed: false, result: null });
    flow = reduceConsent(flow, { type: 'toggleExample' });
    expect(flow.showingExample).toBe(true);
    flow = reduceConsent(flow, { type: 'toggleExample' });
    expect(flow.showingExample).toBe(false);
  });

  it('stores a yes only when the person turns reports on', () => {
    const flow = reduceConsent(openConsent('first'), { type: 'turnOn', now: NOW });
    expect(flow.closed).toBe(true);
    expect(flow.result).toEqual(accepted(NOW));
  });

  it('stores a no when the person keeps reports off', () => {
    const flow = reduceConsent(openConsent('reworded'), { type: 'keepOff', now: NOW });
    expect(flow.result).toEqual(declined(NOW));
  });

  it('treats Escape as a no when the screen opened by itself, so it does not return', () => {
    for (const reason of ['first', 'reworded'] as const) {
      const flow = reduceConsent(openConsent(reason), { type: 'dismiss', now: NOW });
      expect(flow.closed).toBe(true);
      expect(flow.result).toEqual(declined(NOW));
    }
  });

  it('changes nothing when the person opened it from Settings and closes it', () => {
    const flow = reduceConsent(openConsent('settings'), { type: 'dismiss', now: NOW });
    expect(flow.closed).toBe(true);
    expect(flow.result).toBeNull();
  });

  it('ignores everything after the screen has closed', () => {
    const closed = reduceConsent(openConsent('first'), { type: 'keepOff', now: NOW });
    expect(reduceConsent(closed, { type: 'turnOn', now: NOW + 1 })).toBe(closed);
    expect(reduceConsent(closed, { type: 'toggleExample' })).toBe(closed);
  });
});

describe('the wording version', () => {
  it('is the same here and in the Rust crate, so a yes means the same wording on both sides', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../../../crates/crashreport/src/consent.rs', import.meta.url)),
      'utf8',
    );
    const match = /pub const WORDING_VERSION: u32 = (\d+);/.exec(source);
    expect(match, 'the constant is in consent.rs').not.toBeNull();
    expect(Number(match?.[1])).toBe(WORDING_VERSION);
  });
});
