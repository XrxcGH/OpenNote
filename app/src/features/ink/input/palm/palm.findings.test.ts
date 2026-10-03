// One regression test per scenario from the three palm rejection reviews. Positions are mm on the glass; the pen tip
// writes at (100, 100) and a right hand rests below and to its right.

import { describe, expect, it } from 'vitest';
import { End, Fx } from './effects';
import { EMPTY_LEARNED } from './settings';
import { E } from './score';
import { down, effects, filter, FINGER, fxOf, move, NO_SIZE, PALM, pen, px } from './fixtures';

const HAND = [140, 140] as const;
const FAR = [40, 80] as const;
/** A device on which a pen has been seen before this session. */
const PEN_BEFORE = { ...EMPTY_LEARNED, penSeen: true };

describe('a palm that lands before the pen', () => {
  it('is judged when the pen arrives: its tap is swallowed and any camera move reverts', () => {
    const f = filter({ fingerDraw: 'off' }, { penDigitizer: true });
    expect(down(f, 1, 0, ...HAND, NO_SIZE)).toBe('scroll');
    move(f, 1, 100, HAND[0], HAND[1] + 0.5, NO_SIZE);
    pen(f, 'hover', 150);
    expect(effects(f)).toEqual([{ id: 1, role: 'ignore', fx: Fx.SuppressTap }]);
    pen(f, 'down', 200);
    expect(move(f, 1, 220, ...HAND, NO_SIZE)).toBe('ignore');
    expect(f.touchEnd(1, 5000, false) & End.TapAllowed).toBe(0);
  });

  it('turns a heel and pinky pair that landed first into nothing, never a pan', () => {
    const f = filter({ fingerDraw: 'off' }, { penDigitizer: true });
    down(f, 1, 0, ...HAND, NO_SIZE);
    down(f, 2, 60, HAND[0] - 20, HAND[1] - 10, NO_SIZE);
    pen(f, 'hover', 150);
    expect(f.roleOf(1)).toBe(1);
    expect(f.roleOf(2)).toBe(1);
  });
});

describe('two-finger pan near the pen', () => {
  it('never starts while the pen is down', () => {
    const f = filter();
    pen(f, 'hover', 0);
    pen(f, 'down', 10);
    pen(f, 'move', 500);
    expect(down(f, 1, 510, ...FAR)).toBe('ignore');
    expect(down(f, 2, 560, FAR[0] - 30, FAR[1])).toBe('ignore');
  });

  it('never pairs a heel and a pinky under a hovering pen, sizes or not', () => {
    for (const size of [NO_SIZE, FINGER]) {
      const f = filter();
      pen(f, 'hover', 0);
      down(f, 1, 10, ...HAND, size);
      const second = down(f, 2, 50, HAND[0] - 25, HAND[1] - 15, size);
      for (let t = 60; t < 400; t += 16) {
        move(f, 1, t, HAND[0] + (t - 60) / 30, HAND[1], size);
        move(f, 2, t, HAND[0] - 25 + (t - 60) / 30, HAND[1] - 15, size);
        pen(f, 'hover', t + 1);
        expect(effects(f).some((e) => e.fx & Fx.Start)).toBe(false);
      }
      expect(['ignore', 'nav']).toContain(second);
    }
  });

  it('lets the other hand pan and pinch on the far side, with a palm resting', () => {
    const f = filter();
    pen(f, 'hover', 0);
    pen(f, 'down', 10);
    expect(down(f, 1, 20, ...HAND, PALM)).toBe('ignore');
    pen(f, 'up', 3000);
    pen(f, 'hover', 3010);
    expect(down(f, 2, 3020, ...FAR)).toBe('scroll');
    expect(down(f, 3, 3060, FAR[0] - 40, FAR[1])).toBe('nav');
    let started = false;
    for (let t = 3070; t < 3300; t += 16) {
      pen(f, 'hover', t);
      move(f, 2, t, FAR[0], FAR[1] - (t - 3060) / 20);
      move(f, 3, t + 1, FAR[0] - 40, FAR[1] - (t - 3060) / 20);
      started ||= effects(f).some((e) => (e.fx & Fx.Start) !== 0);
    }
    expect(started).toBe(true);
    expect(down(f, 4, 3400, HAND[0] + 5, HAND[1] + 5, PALM)).toBe('ignore');
    expect(f.roleOf(2)).toBe(5);
    expect(f.roleOf(3)).toBe(5);
  });
});

describe('finger and passive stylus drawing with a resting hand', () => {
  it('draws with a tip that lands after a resting palm', () => {
    const f = filter({ fingerDraw: 'on' });
    expect(down(f, 1, 0, ...HAND, PALM)).toBe('ignore');
    expect(down(f, 2, 400, 100, 100)).toBe('draw');
  });

  it('moves the draw slot from a hand edge that landed small to the tip', () => {
    for (const size of [FINGER, NO_SIZE]) {
      const f = filter({ fingerDraw: 'on' });
      expect(down(f, 1, 0, 125, 130, size)).toBe('draw');
      move(f, 1, 300, 125.2, 130, size);
      expect(down(f, 2, 400, 100, 100, size)).toBe('draw');
      expect(fxOf(f, 1) & Fx.Retract).toBe(Fx.Retract);
    }
  });

  it('keeps a finger stroke that has drawn for 800 ms when the hand lands twice', () => {
    const f = filter({ fingerDraw: 'on' });
    down(f, 1, 0, 100, 100);
    for (let t = 16; t < 800; t += 16) move(f, 1, t, 100 + t / 20, 100);
    expect(down(f, 2, 400, ...HAND, PALM)).toBe('ignore');
    expect(down(f, 3, 800, HAND[0] + 15, HAND[1], PALM)).toBe('ignore');
    expect(fxOf(f, 1)).toBe(0);
    expect(move(f, 1, 816, 141, 100)).toBe('draw');
  });

  it('retracts a stroke whose contact grows into a palm, and never commits it', () => {
    const f = filter({ fingerDraw: 'on' });
    expect(down(f, 1, 0, 100, 100, { size: 7 })).toBe('draw');
    move(f, 1, 60, 100, 100.3, { size: 12 });
    const grown = fxOf(f, 1);
    move(f, 1, 120, 100, 100.4, { size: 30, minor: 22 });
    expect((grown | fxOf(f, 1)) & Fx.Retract).toBe(Fx.Retract);
    expect(f.touchEnd(1, 2000, false) & End.Held).toBe(0);
  });

  it('never draws with a thumb gripping the screen edge, and the real finger draws', () => {
    const f = filter({ fingerDraw: 'on' }, { edgeGrip: true });
    f.setViewport(px(150), px(250));
    expect(down(f, 1, 0, 1, 120, { size: 16, minor: 9 })).toBe('shadow');
    expect(down(f, 2, 400, 70, 100)).toBe('draw');
    f.tick(500);
    expect(fxOf(f, 1)).toBe(Fx.Retract | Fx.SuppressTap);
    expect(f.roleOf(1)).toBe(1);
  });

  it('draws a stroke that starts at a screen edge once it moves away from it', () => {
    const f = filter({ fingerDraw: 'on' }, { edgeGrip: true, touchSize: true });
    f.setViewport(px(150), px(250));
    expect(down(f, 1, 0, 2, 120)).toBe('shadow');
    move(f, 1, 200, 2.2, 120);
    expect(move(f, 1, 230, 4.5, 120)).toBe('draw');
    expect(fxOf(f, 1)).toBe(Fx.Promote);
  });
});

describe('focus loss and page switch', () => {
  it('keeps finger ink on a device with no pen through a blur, and lets the next finger draw', () => {
    const f = filter({}, { penDigitizer: false });
    expect(down(f, 1, 0, 100, 100)).toBe('draw');
    f.system('blur', 100);
    expect(fxOf(f, 1)).toBe(Fx.Commit);
    expect(f.presence(200)).toBe('absent');
    expect(down(f, 2, 300, 100, 100)).toBe('draw');
    expect(f.touchEnd(2, 600, false)).toBe(0);
    expect(fxOf(f, 2)).toBe(Fx.Commit);
  });

  it('commits a held stroke at once on a page switch and ignores leave from away', () => {
    const f = filter({ fingerDraw: 'on' }, { penDigitizer: true }, PEN_BEFORE);
    down(f, 1, 0, 100, 100);
    move(f, 1, 100, 110, 100);
    expect(f.touchEnd(1, 200, false)).toBe(End.Held);
    f.pen('leave', 1, 300, 0, 0, 0, 0);
    expect(f.presence(300)).toBe('away');
    f.system('pageSwitch', 400);
    expect(fxOf(f, 1)).toBe(Fx.Commit);
  });
});

describe('pens without hover and pen presence', () => {
  it('lets one finger scroll after a fast first tap once the pen has gone', () => {
    const f = filter();
    pen(f, 'down', 0);
    pen(f, 'up', 50);
    pen(f, 'hover', 60);
    f.pen('leave', 1, 70, px(100), px(100), 0, 0);
    expect(f.presence(60_000)).toBe('away');
    expect(down(f, 1, 60_000, 100, 100)).toBe('scroll');
  });

  it('judges touch against the last contact point of a no-hover pen, then lets go', () => {
    const f = filter();
    pen(f, 'down', 0);
    pen(f, 'up', 400);
    expect(f.presence(600)).toBe('near');
    expect(f.presence(1000)).toBe('recent');
    expect(down(f, 1, 1000, ...HAND)).toBe('scroll');
    expect(down(f, 2, 3000, ...FAR)).toBe('scroll');
    f.touchEnd(1, 3100, false);
    f.touchEnd(2, 3100, false);
    expect(f.presence(25_000)).toBe('away');
  });

  it('stays near while a latched palm rests, past grace and the hover watchdog', () => {
    const f = filter();
    pen(f, 'hover', 0);
    pen(f, 'down', 10);
    down(f, 1, 20, ...HAND, PALM);
    pen(f, 'up', 900);
    f.pen('leave', 1, 1000, 0, 0, 0, 0);
    expect(f.presence(1600)).toBe('near');
    expect(down(f, 2, 1600, HAND[0] + 10, HAND[1] + 10, PALM)).toBe('ignore');
    f.touchEnd(1, 4000, false);
    f.touchEnd(2, 4000, false);
    expect(f.presence(4400)).toBe('near');
    expect(f.presence(4600)).toBe('recent');
  });

  it('keeps hovering for 5 s on WebKit, which reports hover only on change', () => {
    const f = filter({}, { platform: 'ipados' });
    pen(f, 'hover', 0);
    expect(f.presence(4900)).toBe('near');
    expect(f.presence(5600)).toBe('recent');
  });

  it('lets a down pen that left range and fell silent go, and a lost up after 10 s', () => {
    const f = filter();
    pen(f, 'down', 10);
    f.pen('leave', 1, 20, 0, 0, 0, 0);
    expect(f.presence(300)).toBe('down');
    expect(f.presence(330)).toBe('near');
    const g = filter();
    pen(g, 'down', 10);
    expect(g.presence(10_009)).toBe('down');
    expect(g.presence(10_600)).toBe('recent');
  });

  it('stays near while a second pen hovers after the first leaves', () => {
    const f = filter();
    pen(f, 'hover', 0, 100, 100, 1);
    pen(f, 'hover', 10, 300, 100, 2);
    f.pen('leave', 1, 20, 0, 0, 0, 0);
    pen(f, 'hover', 600, 300, 100, 2);
    expect(f.presence(700)).toBe('near');
  });
});

describe('controls outside the page', () => {
  it('ignores a palm on the palette while writing and keeps the other hand working', () => {
    const f = filter();
    pen(f, 'hover', 0);
    pen(f, 'down', 10);
    expect(down(f, 1, 20, HAND[0], HAND[1], { ...PALM, surface: 'chrome' })).toBe('ignore');
    expect(down(f, 2, 30, FAR[0], FAR[1], { ...FINGER, surface: 'chrome' })).toBe('pass');
    pen(f, 'up', 40);
    pen(f, 'hover', 45);
    expect(down(f, 3, 60, FAR[0] - 20, FAR[1], { ...FINGER, surface: 'chrome' })).toBe('pass');
    expect(f.touchEnd(3, 120, false) & End.TapAllowed).toBe(End.TapAllowed);
  });
});

describe('contact size in millimeters', () => {
  it('treats a thumb on an Android tablet as a thumb, not a palm', () => {
    const f = filter({ fingerDraw: 'on' }, { pxPerMm: 6.3 });
    expect(f.touchDown(1, 0, 300, 300, 80, 70, 0, 'page')).toBe(2);
  });

  it('ignores size evidence on a digitizer that reports one constant size', () => {
    const f = filter();
    pen(f, 'hover', 0);
    for (let id = 1; id <= 8; id++) {
      f.touchDown(id, id * 10, px(FAR[0]), px(FAR[1]), px(25), px(25), 0, 'chrome');
      f.touchEnd(id, id * 10 + 5, false);
    }
    expect(down(f, 9, 200, FAR[0], FAR[1], { size: 25, surface: 'chrome' })).toBe('pass');
  });
});

describe('contacts that never end', () => {
  it('forgets a contact silent for 10 s, and ignores unknown ids', () => {
    const f = filter({ fingerDraw: 'on' }, { penDigitizer: false });
    down(f, 1, 0, 100, 100);
    expect(down(f, 2, 60_000, 100, 100)).toBe('draw');
    expect(move(f, 7, 60_010, 100, 100)).toBe('ignore');
    expect(f.touchEnd(7, 60_020, false)).toBe(0);
  });

  it('marks live contacts ignored on blur, so a palm never becomes live', () => {
    const f = filter();
    pen(f, 'hover', 0);
    down(f, 1, 10, ...HAND, PALM);
    f.system('blur', 20);
    expect(move(f, 1, 30, ...HAND, PALM)).toBe('ignore');
  });
});

describe('touch stroke holds', () => {
  it('commits at once until a pen is seen, and holds for grace once one has been', () => {
    for (const f of [filter({}, { penDigitizer: false }), filter({}, { penDigitizer: true })]) {
      down(f, 1, 0, 100, 100);
      expect(f.touchEnd(1, 300, false)).toBe(0);
      expect(fxOf(f, 1)).toBe(Fx.Commit);
    }
    const g = filter({ fingerDraw: 'on' }, { penDigitizer: true }, PEN_BEFORE);
    down(g, 1, 0, 100, 100);
    move(g, 1, 50, 110, 100);
    expect(g.touchEnd(1, 300, false)).toBe(End.Held);
    g.tick(831);
    expect(fxOf(g, 1)).toBe(0);
    g.tick(832);
    expect(fxOf(g, 1)).toBe(Fx.Commit);
  });

  it('drops a held stroke when the pen arrives, and takes back one committed just before', () => {
    const f = filter({ fingerDraw: 'on' }, { penDigitizer: true }, PEN_BEFORE);
    down(f, 1, 0, ...HAND);
    move(f, 1, 50, HAND[0] + 5, HAND[1]);
    f.touchEnd(1, 100, false);
    pen(f, 'hover', 400);
    expect(fxOf(f, 1)).toBe(Fx.Retract);
    const g = filter({ fingerDraw: 'on' }, { penDigitizer: true }, PEN_BEFORE);
    down(g, 1, 0, ...HAND);
    move(g, 1, 50, HAND[0] + 5, HAND[1]);
    g.touchEnd(1, 100, false);
    g.tick(700);
    expect(fxOf(g, 1)).toBe(Fx.Commit);
    pen(g, 'hover', 900);
    expect(fxOf(g, 1)).toBe(Fx.Uncommit);
  });

  it('drops a live finger stroke when the pen hovers, and a blur never does', () => {
    const f = filter({ fingerDraw: 'on' }, { penDigitizer: true }, PEN_BEFORE);
    down(f, 1, 0, 100, 100);
    f.system('blur', 50);
    expect(fxOf(f, 1)).toBe(Fx.Hold);
    down(f, 2, 100, 100, 100);
    pen(f, 'hover', 150);
    expect(fxOf(f, 2) & Fx.Retract).toBe(Fx.Retract);
  });
});

describe('finger drawing pairs', () => {
  it('turns a still stroke into a pinch when the second finger lands within 300 ms and they spread', () => {
    const f = filter({ fingerDraw: 'on' });
    down(f, 1, 0, 100, 100);
    move(f, 1, 100, 100.3, 100);
    expect(down(f, 2, 250, 60, 90)).toBe('pend');
    expect(f.roleOf(1)).toBe(6);
    move(f, 1, 280, 101.6, 100);
    expect(move(f, 2, 290, 58, 90)).toBe('nav');
    expect(fxOf(f, 1)).toBe(Fx.Retract | Fx.Start);
    expect(fxOf(f, 2)).toBe(Fx.Retract | Fx.Start);
  });

  it('gives the stroke back when the second contact rests while the first writes', () => {
    const f = filter({ fingerDraw: 'on' }, { touchSize: true });
    down(f, 1, 0, 100, 100);
    expect(down(f, 2, 100, 128, 135)).toBe('pend');
    move(f, 2, 150, 128.2, 135);
    expect(move(f, 1, 200, 104, 100)).toBe('draw');
    expect(fxOf(f, 1)).toBe(Fx.Promote);
    expect(fxOf(f, 2)).toBe(Fx.Retract);
  });

  it('keeps a moving stroke when the second finger lands after 150 ms', () => {
    const f = filter({ fingerDraw: 'on' });
    down(f, 1, 0, 100, 100);
    move(f, 1, 100, 106, 100);
    expect(down(f, 2, 160, 60, 90)).not.toBe('nav');
    expect(f.roleOf(1)).toBe(2);
  });

  it('voids a pair when a third finger lands inside the window', () => {
    const f = filter({ fingerDraw: 'on' });
    down(f, 1, 0, 100, 100);
    down(f, 2, 10, 70, 100);
    expect(down(f, 3, 20, 40, 100)).toBe('ignore');
    expect(f.roleOf(1)).toBe(1);
    expect(f.roleOf(2)).toBe(1);
  });
});

describe('native hints and handedness', () => {
  it('latches a contact the OS calls a palm', () => {
    const f = filter();
    pen(f, 'hover', 0);
    down(f, 1, 10, ...FAR);
    f.hint('palm', 15, px(FAR[0]), px(FAR[1]));
    expect(fxOf(f, 1) & Fx.SuppressTap).toBe(Fx.SuppressTap);
  });

  it('mirrors the hand region for a left-handed writer', () => {
    const f = filter({ handedness: 'left' });
    f.pen('hover', 1, 0, px(100), px(100), -20, 25);
    down(f, 1, 20, 60, 140);
    expect(f.explain(1) & E.HandRegion).toBe(E.HandRegion);
    down(f, 2, 30, 180, 80);
    expect(f.explain(2) & E.FarSide).toBe(E.FarSide);
  });

  it('turns finger drawing off when the OS prefers pencil-only drawing', () => {
    const f = filter({}, { pencilOnly: true, penDigitizer: true });
    expect(down(f, 1, 0, 100, 100)).toBe('scroll');
  });
});

describe('settings and boundaries', () => {
  it('pairs a second finger at 150 ms after a moving first one, and not at 151 ms', () => {
    for (const [late, role] of [
      [150, 'pend'],
      [151, 'shadow'],
    ] as const) {
      const f = filter({ fingerDraw: 'on' });
      down(f, 1, 0, 100, 100);
      move(f, 1, 100, 106, 100);
      expect(down(f, 2, late, 60, 90)).toBe(role);
    }
  });

  it('latches palm at 20 mm long but not just under it', () => {
    const f = filter({ fingerDraw: 'on' });
    expect(down(f, 1, 0, 100, 100, { size: 19.9, minor: 10 })).toBe('draw');
    const g = filter({ fingerDraw: 'on' });
    expect(down(g, 1, 0, 100, 100, { size: 20, minor: 10 })).toBe('ignore');
  });

  it('applies a settings change to new contacts and keeps a live stroke', () => {
    const f = filter({ fingerDraw: 'on' }, { penDigitizer: false });
    expect(down(f, 1, 0, 100, 100)).toBe('draw');
    f.configure({ fingerDraw: 'off', graceMs: 99_999 });
    expect(move(f, 1, 50, 110, 100)).toBe('draw');
    expect(down(f, 2, 2000, 100, 140)).toBe('pass');
    f.setInkToolActive(false);
    expect(f.touchPolicy()).toBe('native');
  });

  it('never retracts a live stroke on a tick that runs ahead of queued events', () => {
    const f = filter({ fingerDraw: 'on' }, { penDigitizer: true });
    down(f, 1, 0, 100, 100);
    move(f, 1, 50, 110, 100);
    f.tick(5000);
    expect(fxOf(f, 1)).toBe(0);
    expect(move(f, 1, 60, 111, 100)).toBe('draw');
  });
});
