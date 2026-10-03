import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createPalmFilter } from './palm';
import type { PalmFilter, PalmSettings, PenSignal, Surface, TouchContact } from './palm';

const finger = (id: number, time: number, extra: Partial<TouchContact> = {}): TouchContact => ({
  id,
  time,
  width: 12,
  height: 12,
  surface: 'page',
  ...extra,
});

const palm = (id: number, time: number) => finger(id, time, { width: 90, height: 120 });

describe('the pen states', () => {
  it('walks from away to hovering, down, hovering, and through grace to away', () => {
    const filter = createPalmFilter();
    expect(filter.penState(0)).toBe('away');
    filter.pen('hover', 10);
    expect(filter.penState(10)).toBe('hovering');
    filter.pen('down', 20);
    expect(filter.penState(20)).toBe('down');
    filter.pen('move', 30);
    expect(filter.penState(30)).toBe('down');
    filter.pen('up', 40);
    expect(filter.penState(40)).toBe('hovering');
    filter.pen('leave', 50);
    expect(filter.penState(50)).toBe('grace');
    expect(filter.penState(549)).toBe('grace');
    expect(filter.penState(550)).toBe('away');
  });

  it('leaves grace for hovering or down on any pen event', () => {
    const filter = createPalmFilter();
    filter.pen('hover', 0);
    filter.pen('leave', 10);
    filter.pen('hover', 100);
    expect(filter.penState(100)).toBe('hovering');
    filter.pen('lost', 200);
    filter.pen('down', 250);
    expect(filter.penState(250)).toBe('down');
  });

  it('counts a hovering pen as gone after the watchdog, 2 seconds without an event', () => {
    const filter = createPalmFilter();
    filter.pen('hover', 0);
    expect(filter.penState(1999)).toBe('hovering');
    expect(filter.penState(2000)).toBe('grace');
    expect(filter.penState(2499)).toBe('grace');
    expect(filter.penState(2500)).toBe('away');
  });

  it('uses grace after a lift on a digitizer that never reports hover', () => {
    const filter = createPalmFilter();
    filter.pen('down', 0);
    filter.pen('up', 30);
    expect(filter.penState(30)).toBe('grace');
    expect(filter.penState(530)).toBe('away');
  });

  it('treats a lost window or capture as the pen leaving, and a cancel as a lift', () => {
    const filter = createPalmFilter();
    filter.pen('hover', 0);
    filter.pen('lost', 10);
    expect(filter.penState(10)).toBe('grace');
    filter.pen('down', 20);
    filter.pen('cancel', 30);
    expect(filter.penState(30)).toBe('hovering');
  });

  it('ignores a leave while the pen is down, and keeps grace within its limits', () => {
    const filter = createPalmFilter({ graceMs: 10 });
    filter.pen('down', 0);
    filter.pen('leave', 5);
    expect(filter.penState(5)).toBe('down');
    filter.pen('lost', 10);
    expect(filter.penState(309)).toBe('grace');
    expect(filter.penState(310)).toBe('away');
    filter.configure({ graceMs: 99_999 });
    filter.pen('lost', 1000);
    expect(filter.penState(2999)).toBe('grace');
    expect(filter.penState(3000)).toBe('away');
  });
});

function near(): PalmFilter {
  const filter = createPalmFilter();
  filter.pen('hover', 0);
  return filter;
}

describe('touch while the pen is near', () => {
  it('ignores a single touch completely', () => {
    const filter = near();
    expect(filter.touchDown(finger(1, 10)).role).toBe('ignore');
    expect(filter.touchMove(1)).toBe('ignore');
    expect(filter.touchEnd(1, 50, false)).toEqual({ role: 'ignore', drop: false, hold: null });
  });

  it('pans with two fingers that start within 150 ms, each smaller than a palm', () => {
    const filter = near();
    filter.touchDown(finger(1, 10));
    const second = filter.touchDown(finger(2, 100));
    expect(second.role).toBe('pan');
    expect(second.changed).toEqual([1]);
    expect(filter.touchMove(1)).toBe('pan');
  });

  it('ignores two fingers that start too far apart, or when one is a palm, or when two-finger pan is off', () => {
    for (const make of [
      (f: PalmFilter) => [f.touchDown(finger(1, 10)), f.touchDown(finger(2, 300))],
      (f: PalmFilter) => [f.touchDown(palm(1, 10)), f.touchDown(finger(2, 50))],
      (f: PalmFilter) => [f.touchDown(finger(1, 10)), f.touchDown(palm(2, 50))],
    ]) {
      expect(make(near())[1].role).toBe('ignore');
    }
    const off = near();
    off.configure({ twoFingerPan: false });
    off.touchDown(finger(1, 10));
    expect(off.touchDown(finger(2, 50)).role).toBe('ignore');
  });

  it('ignores three or more fingers, turning a pan back into nothing', () => {
    const filter = near();
    filter.touchDown(finger(1, 10));
    filter.touchDown(finger(2, 40));
    const third = filter.touchDown(finger(3, 80));
    expect(third.role).toBe('ignore');
    expect([...third.changed].sort()).toEqual([1, 2]);
    expect(filter.touchMove(1)).toBe('ignore');
  });

  it('lets a lone finger left from a pan do nothing', () => {
    const filter = near();
    filter.touchDown(finger(1, 10));
    filter.touchDown(finger(2, 40));
    filter.touchEnd(2, 200, false);
    expect(filter.touchMove(1)).toBe('ignore');
  });

  it('keeps the controls outside the page working for every finger', () => {
    const filter = near();
    const chrome = (id: number, surface: Surface = 'chrome') => filter.touchDown(finger(id, 20, { surface }));
    expect(chrome(1).role).toBe('pass');
    expect(chrome(2).role).toBe('pass');
    expect(filter.touchDown(palm(3, 20)).role).toBe('ignore');
  });

  it('counts the grace period as near, and a large finger as a finger once the pen is away', () => {
    const filter = createPalmFilter();
    filter.pen('hover', 0);
    filter.pen('leave', 10);
    expect(filter.touchDown(finger(1, 400)).role).toBe('ignore');
    filter.touchEnd(1, 410, false);
    expect(filter.touchDown(finger(2, 600)).role).toBe('pass');
    expect(filter.touchDown(palm(3, 700)).role).toBe('pass');
  });
});

const drawing = (extra: Partial<PalmSettings> = {}) => createPalmFilter({ drawWithTouch: true, ...extra });

describe('draw with touch and the pen away', () => {
  it('draws with a fingertip and never with a palm', () => {
    const filter = drawing();
    expect(filter.touchDown(finger(1, 0)).role).toBe('draw');
    expect(filter.touchDown(palm(2, 1000)).role).toBe('ignore');
    const solo = drawing();
    expect(solo.touchDown(palm(1, 0)).role).toBe('ignore');
  });

  it('skips the size rule for a digitizer that reports no contact size', () => {
    const filter = drawing();
    expect(filter.touchDown(finger(1, 0, { width: 1, height: 1 })).role).toBe('draw');
  });

  it('cancels the stroke when a second finger arrives within 150 ms, and pans', () => {
    const filter = drawing();
    filter.touchDown(finger(1, 0));
    const second = filter.touchDown(finger(2, 100));
    expect(second).toMatchObject({ role: 'pan', cancelDraw: true, changed: [1] });
  });

  it('keeps drawing when a second finger arrives later, and ignores it', () => {
    const filter = drawing();
    filter.touchDown(finger(1, 0));
    expect(filter.touchDown(finger(2, 400))).toMatchObject({ role: 'ignore', cancelDraw: false });
    expect(filter.touchMove(1)).toBe('draw');
  });

  it('lets the browser scroll with any finger when draw with touch is off', () => {
    const filter = createPalmFilter();
    expect(filter.touchDown(finger(1, 0)).role).toBe('pass');
    expect(filter.touchDown(palm(2, 10)).role).toBe('pass');
  });
});

describe('touch strokes held for the grace period', () => {
  it('commits after the grace period when no pen came near', () => {
    const filter = drawing();
    filter.touchDown(finger(1, 0));
    const end = filter.touchEnd(1, 300, false);
    expect(end.hold).toEqual({ started: 0, until: 800 });
    expect(filter.heldFate(end.hold!, 500)).toBe('wait');
    expect(filter.heldFate(end.hold!, 800)).toBe('commit');
  });

  it('drops the stroke when a pen comes into range during the stroke or the hold', () => {
    const filter = drawing();
    filter.touchDown(finger(1, 0));
    const end = filter.touchEnd(1, 300, false);
    filter.pen('hover', 600);
    expect(filter.heldFate(end.hold!, 900)).toBe('drop');
    const live = drawing();
    live.touchDown(finger(1, 0));
    expect(live.pen('hover', 100)).toEqual([1]);
    expect(live.touchMove(1)).toBe('ignore');
  });

  it('drops the stroke when Windows cancels the touch as a palm', () => {
    const filter = drawing();
    filter.touchDown(finger(1, 0));
    expect(filter.touchEnd(1, 100, true)).toEqual({ role: 'draw', drop: true, hold: null });
  });

  it('does not hold an ignored or passed contact', () => {
    const filter = near();
    filter.touchDown(finger(1, 10));
    expect(filter.touchEnd(1, 90, false).hold).toBeNull();
  });
});

describe('a digitizer without hover', () => {
  it('stays near while an ink tool is active after the first contact without hover', () => {
    const filter = createPalmFilter();
    filter.setInkToolActive(true);
    filter.pen('down', 0);
    filter.pen('up', 50);
    expect(filter.penNear(5000)).toBe(true);
    expect(filter.touchDown(finger(1, 5000)).role).toBe('ignore');
    filter.setInkToolActive(false);
    expect(filter.penNear(5000)).toBe(false);
  });

  it('is not sticky for a digitizer that reports hover', () => {
    const filter = createPalmFilter();
    filter.setInkToolActive(true);
    filter.pen('hover', 0);
    filter.pen('down', 10);
    filter.pen('up', 20);
    filter.pen('lost', 30);
    expect(filter.penNear(5000)).toBe(false);
  });
});

describe('palm rejection under random input', () => {
  const signals: PenSignal[] = ['hover', 'down', 'move', 'up', 'cancel', 'leave', 'lost'];
  const event = fc.oneof(
    fc.record({
      kind: fc.constant('pen' as const),
      signal: fc.constantFrom(...signals),
      dt: fc.integer({ min: 0, max: 900 }),
    }),
    fc.record({
      kind: fc.constant('down' as const),
      id: fc.integer({ min: 1, max: 4 }),
      dt: fc.integer({ min: 0, max: 400 }),
      big: fc.boolean(),
      chrome: fc.boolean(),
    }),
    fc.record({
      kind: fc.constant('up' as const),
      id: fc.integer({ min: 1, max: 4 }),
      dt: fc.integer({ min: 0, max: 400 }),
      canceled: fc.boolean(),
    }),
  );

  it('never lets a page touch draw or pan while the pen is near unless it is two fingers together', () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 80 }), fc.boolean(), (events, drawWithTouch) => {
        const filter = createPalmFilter({ drawWithTouch });
        const open = new Set<number>();
        let now = 0;
        for (const e of events) {
          now += e.dt;
          if (e.kind === 'pen') {
            filter.pen(e.signal, now);
          } else if (e.kind === 'down' && !open.has(e.id)) {
            open.add(e.id);
            const wasNear = filter.penNear(now);
            const decision = filter.touchDown(
              finger(e.id, now, { width: e.big ? 100 : 10, height: 10, surface: e.chrome ? 'chrome' : 'page' }),
            );
            if (e.chrome) expect(decision.role).toBe('pass');
            else if (wasNear) expect(decision.role === 'ignore' || decision.role === 'pan').toBe(true);
          } else if (e.kind === 'up' && open.has(e.id)) {
            open.delete(e.id);
            const end = filter.touchEnd(e.id, now, e.canceled);
            expect(end.drop && end.hold).toBeFalsy();
          }
          for (const id of open) {
            if (filter.penNear(now)) expect(filter.touchMove(id)).not.toBe('draw');
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
