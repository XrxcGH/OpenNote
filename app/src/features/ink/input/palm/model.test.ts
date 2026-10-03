// Presence, the hand region, and the evidence score, each on its own.

import { describe, expect, it } from 'vitest';
import { ContactTable, F, SizeMode } from './contacts';
import { HandRegion, leanOf } from './handRegion';
import { P, PenSlots } from './presence';
import { E, explainBits, ScoreContext, scoreContact } from './score';
import { PEN_HAND, TOUCH_HAND } from './thresholds';

describe('pen presence', () => {
  const slots = () => {
    const s = new PenSlots();
    s.graceMs = 500;
    s.watchdogMs = 2000;
    return s;
  };

  it('walks hovering, down, grace after a lift with no hover, recent, and away', () => {
    const s = slots();
    expect(s.presence(0, false)).toBe(P.Away);
    expect(s.presence(0, true)).toBe(P.Absent);
    s.apply('hover', 1, 0);
    expect(s.presence(10, true)).toBe(P.Near);
    s.apply('down', 1, 20);
    expect(s.presence(20, true)).toBe(P.Down);
    s.apply('up', 1, 40);
    expect(s.presence(539, true)).toBe(P.Near);
    expect(s.presence(540, true)).toBe(P.Recent);
    expect(s.presence(20_039, true)).toBe(P.Recent);
    expect(s.presence(20_040, true)).toBe(P.Away);
  });

  it('never counts leave as pen evidence, and leave from away does nothing', () => {
    const s = slots();
    expect(s.apply('leave', 1, 0)).toBe(false);
    expect(s.penSeen).toBe(false);
    expect(s.presence(1, false)).toBe(P.Away);
  });

  it('ends hover after the watchdog, unless a palm holds the pen near', () => {
    const s = slots();
    s.apply('hover', 1, 0);
    expect(s.presence(2499, false)).toBe(P.Near);
    expect(s.presence(2500, false)).toBe(P.Recent);
    s.handHeld = true;
    expect(s.stateAt(0, 9000)).toBe(1);
  });

  it('moves a hovering pen to grace on blur, and only a down pen on a lost capture', () => {
    const s = slots();
    s.apply('hover', 1, 0);
    s.release(100, true);
    expect(s.stateAt(0, 100)).toBe(1);
    s.release(100, false);
    expect(s.stateAt(0, 100)).toBe(3);
    expect(s.presence(600, false)).toBe(P.Recent);
  });
});

describe('the hand region', () => {
  it('holds the palm below right of a right hand, the forearm, and the gripping fingers', () => {
    const h = new HandRegion(PEN_HAND);
    expect(h.membership(140, 145, 100, 100)).toBe(1);
    expect(h.membership(110, 105, 100, 100)).toBe(1);
    expect(h.membership(240, 260, 100, 100)).toBe(1);
    expect(h.membership(40, 80, 100, 100)).toBe(0);
    expect(h.farFrom(40, 80, 100, 100)).toBe(true);
    expect(h.farFrom(140, 145, 100, 100)).toBe(false);
  });

  it('takes the first lean at once, blends later ones, and lets 5 contrary strokes overrule a setting', () => {
    const lean = { x: 0, y: 0 };
    expect(leanOf(5, 5, lean)).toBe(false);
    expect(leanOf(-30, 20, lean)).toBe(true);
    const h = new HandRegion(PEN_HAND);
    h.lean(lean.x, lean.y);
    expect(h.ox).toBeLessThan(0);
    const pinned = new HandRegion(PEN_HAND);
    pinned.set(PEN_HAND, true);
    pinned.seeded = true;
    for (let i = 0; i < 4; i++) pinned.lean(lean.x, lean.y);
    expect(pinned.ox).toBe(PEN_HAND.ox);
    pinned.lean(lean.x, lean.y);
    expect(pinned.ox).toBeLessThan(PEN_HAND.ox);
  });

  it('learns toward where palms land and keeps the radius in 35 to 80 mm', () => {
    const h = new HandRegion(TOUCH_HAND);
    for (let i = 0; i < 40; i++) h.learn(60, 10);
    expect(h.ox).toBeCloseTo(60, 0);
    expect(h.r).toBeGreaterThanOrEqual(35);
    expect(h.r).toBeLessThanOrEqual(80);
  });
});

describe('the evidence score', () => {
  const setup = (presence: P) => {
    const c = new ContactTable();
    const x = new ScoreContext(new HandRegion(PEN_HAND), new HandRegion(TOUCH_HAND));
    x.presence = presence;
    x.penCtx = presence >= P.Recent;
    x.tipValid = true;
    x.tipX = 100;
    x.tipY = 100;
    x.sinceEvidence = 100;
    return { c, x };
  };

  const cases: [string, P, (c: ContactTable, i: number) => void, number, number][] = [
    ['a heel under a hovering pen', P.Near, () => {}, 3, E.HandRegion],
    [
      'a heel that lands while the pen is down',
      P.Down,
      (c, i) => (c.flags[i] |= F.PenDownAtLand),
      5,
      E.HandRegion | E.PenDown,
    ],
    ['a contact the OS cancels', P.Away, (c, i) => (c.flags[i] |= F.OsPalm), 4, E.OsPalm],
    ['a palm that landed first', P.Near, (c, i) => (c.flags[i] |= F.PalmFirst), 5, E.HandRegion | E.PalmFirst],
    ['a contact 300 ms after a lift', P.Recent, (c, i) => (c.sinceUp[i] = 300), 4, E.HandRegion | E.AfterPen],
  ];

  it.each(cases)('scores %s', (_, presence, prep, score, why) => {
    const { c, x } = setup(presence);
    const i = c.add(1, 0, 140, 140);
    prep(c, i);
    expect(scoreContact(c, i, x)).toBe(score);
    expect(explainBits(c.why[i])).toBe(explainBits(why));
  });

  it('gives a far-side swipe of the other hand negative evidence', () => {
    const { c, x } = setup(P.Near);
    const i = c.add(1, 0, 40, 80);
    for (let t = 10; t <= 150; t += 10) c.moveTo(i, t, 40, 80 - t / 10);
    x.t = 150;
    expect(scoreContact(c, i, x)).toBe(-5);
    expect(c.why[i]).toBe(E.FarSide | E.Swipe);
  });

  it('reads palm size, growth, and fingertips only from a digitizer with real sizes', () => {
    const { c, x } = setup(P.Near);
    const i = c.add(1, 0, 40, 80);
    c.sizeTo(i, 40, 40, 8, 8, 0);
    c.sizeTo(i, 80, 40, 16, 8, 0);
    expect(c.sizeMode).toBe(SizeMode.Real);
    scoreContact(c, i, x);
    expect(c.why[i] & (E.Growth | E.Large)).toBe(E.Growth | E.Large);
    const j = c.add(2, 0, 30, 40);
    c.sizeTo(j, 30, 30, 6, 6, 0);
    expect(scoreContact(c, j, x)).toBe(-3);
    expect(c.why[j]).toBe(E.FarSide | E.Fingertip);
  });

  it('counts a still contact, a split blob, and a burst of landings', () => {
    const { c, x } = setup(P.Near);
    const a = c.add(1, 0, 140, 140);
    const b = c.add(2, 20, 148, 140);
    x.land(0, 140, 140);
    x.land(20, 148, 140);
    x.land(40, 150, 150);
    x.t = 600;
    scoreContact(c, a, x);
    expect(c.why[a] & (E.Still | E.Split | E.Burst)).toBe(E.Still | E.Split | E.Burst);
    expect(c.why[b] & E.Split).toBe(0);
  });
});
