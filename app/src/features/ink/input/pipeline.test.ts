// The wiring shared by the page view and the replayer, and the managed touch math under it.

import { describe, expect, it } from 'vitest';
import { createInkPipeline } from './pipeline';
import type { PipelineHost, PointerRecord } from './pipeline';
import { createStrokeBuilder } from './strokeBuilder';
import { glide, TouchNav } from './touchNav';
import { PENS } from '../pens/palette';

const PPM = 5.2;

function host() {
  const calls: string[] = [];
  let n = 0;
  const h: PipelineHost = {
    penSample: (r) => calls.push(`pen ${r.type}`),
    touchBuilder: () =>
      createStrokeBuilder({
        tool: 'pen',
        width: 2,
        slot: 0,
        color: PENS[0].light,
        block: 'b',
        newId: () => `s${++n}`,
        timeOrigin: 0,
      }),
    toPage: (r, out) => {
      out.x = r.x;
      out.y = r.y;
    },
    touchStroke: (id, phase) => calls.push(`ink ${id} ${phase}`),
    camera: (op, id, a, b) =>
      calls.push(`camera ${op} ${id}${op === 'panBy' ? ` ${a.toFixed(1)},${b.toFixed(1)}` : ''}`),
    tap: (id, allowed) => calls.push(`tap ${id} ${allowed}`),
    contextMenu: (id, allowed) => calls.push(`menu ${id} ${allowed}`),
    gesture: (kind) => calls.push(`gesture ${kind}`),
    touchPolicy: (p) => calls.push(`policy ${p}`),
  };
  return { h, calls };
}

const rec = (
  type: PointerRecord['type'],
  kind: PointerRecord['kind'],
  id: number,
  t: number,
  xMm: number,
  yMm: number,
  buttons = 1,
): PointerRecord => ({
  type,
  id,
  kind,
  t,
  x: xMm * PPM,
  y: yMm * PPM,
  w: kind === 'touch' ? 9 * PPM : 1,
  h: kind === 'touch' ? 8 * PPM : 1,
  p: 0.5,
  tiltX: 20,
  tiltY: 25,
  buttons,
  surface: 'page',
});

describe('the ink pipeline', () => {
  it('passes every pen sample straight to the tool before the filter runs', () => {
    const { h, calls } = host();
    const p = createInkPipeline(h, {}, { pxPerMm: PPM });
    p.handle(rec('move', 'pen', 1, 0, 100, 100, 0));
    p.handle(rec('down', 'pen', 1, 10, 100, 100));
    p.handle(rec('move', 'pen', 1, 18, 101, 100));
    p.handle(rec('up', 'pen', 1, 26, 102, 100, 0));
    expect(calls.filter((c) => c.startsWith('pen'))).toEqual(['pen down', 'pen move', 'pen up']);
    expect(calls).toContain('policy managed');
  });

  it('commits finger ink at once on a phone, showing it only once it moves', () => {
    const { h, calls } = host();
    const p = createInkPipeline(h, {}, { pxPerMm: PPM, penDigitizer: false, touchSize: true });
    p.setInkToolActive(true);
    p.handle(rec('down', 'touch', 5, 0, 50, 50));
    expect(calls).toContain('ink 5 shadow');
    p.handle(rec('move', 'touch', 5, 60, 52, 50));
    p.handle(rec('up', 'touch', 5, 70, 54, 50, 0));
    const ink = ['ink 5 shadow', 'ink 5 show', 'ink 5 point', 'ink 5 commit'];
    expect(calls.filter((c) => c.startsWith('ink 5'))).toEqual(ink);
  });

  it('swallows the tap of a palm that landed before the pen, and starts a far-side scroll', () => {
    const { h, calls } = host();
    const p = createInkPipeline(h, { fingerDraw: 'off' }, { pxPerMm: PPM, penDigitizer: true });
    p.setInkToolActive(true);
    p.handle(rec('down', 'touch', 7, 0, 140, 140));
    p.handle(rec('move', 'pen', 1, 100, 100, 100, 0));
    p.handle(rec('up', 'touch', 7, 200, 140, 140, 0));
    expect(calls).toContain('tap 7 false');
    p.handle(rec('down', 'touch', 8, 300, 30, 80));
    for (let t = 310; t < 500; t += 10) p.handle(rec('move', 'touch', 8, t, 30, 80 - (t - 300) / 5));
    expect(calls.some((c) => c.startsWith('camera panBy 8'))).toBe(true);
  });

  it('delivers an undo from a two-finger double tap only after the confirm window', () => {
    const { h, calls } = host();
    const p = createInkPipeline(h, { fingerDraw: 'off' }, { pxPerMm: PPM, penDigitizer: false });
    for (const t of [0, 300]) {
      p.handle(rec('down', 'touch', 10 + t, t, 40, 80));
      p.handle(rec('down', 'touch', 11 + t, t + 10, 65, 80));
      p.handle(rec('up', 'touch', 10 + t, t + 100, 40, 80, 0));
      p.handle(rec('up', 'touch', 11 + t, t + 110, 65, 80, 0));
    }
    p.tick(500);
    expect(calls).not.toContain('gesture undo');
    p.tick(600);
    expect(calls).toContain('gesture undo');
  });
});

describe('contacts the pipeline ends', () => {
  it('ends only the cancelled contact and lets go of its camera snapshot and its tick', () => {
    const { h, calls } = host();
    const p = createInkPipeline(h, {}, { pxPerMm: PPM });
    p.handle(rec('down', 'touch', 1, 0, 40, 100));
    p.handle(rec('down', 'touch', 2, 5, 120, 100));
    p.handle(rec('cancel', 'touch', 1, 50, 40, 100));
    expect(calls).toContain('camera release 1');
    expect(calls).not.toContain('camera release 2');
    p.handle(rec('up', 'touch', 2, 900, 120, 100, 0));
    expect(p.needsTick()).toBe(false);
  });

  it('forgets every contact when the window loses focus', () => {
    const { h, calls } = host();
    const p = createInkPipeline(h, {}, { pxPerMm: PPM });
    p.handle(rec('down', 'touch', 1, 0, 40, 100));
    p.handle(rec('down', 'touch', 2, 5, 120, 100));
    p.system('blur', 20);
    expect(calls.filter((c) => c.startsWith('camera release'))).toEqual(['camera release 1', 'camera release 2']);
    expect(p.filter.needsTick() || p.needsTick()).toBe(p.filter.needsTick());
  });
});

describe('managed touch navigation', () => {
  it('scrolls by each move from where the scroll started', () => {
    const nav = new TouchNav();
    nav.beginScroll(1, 100, 100, 0);
    expect(nav.move(1, 100, 90, 10)).toBe(true);
    expect([nav.step.dx, nav.step.dy, nav.step.scale]).toEqual([0, -10, 1]);
    expect(nav.move(2, 0, 0, 10)).toBe(false);
    expect(nav.sumDy).toBe(-10);
  });

  it('pans by half of each finger move and zooms by the change in spacing', () => {
    const nav = new TouchNav();
    nav.beginPinch([1, 2], [100, 200], [100, 100], 0);
    nav.move(2, 300, 100, 10);
    expect(nav.step.scale).toBe(2);
    expect(nav.step.dx).toBe(50);
    expect(nav.zoom).toBe(2);
  });

  it('flings at the lift speed and glides to a stop', () => {
    const nav = new TouchNav();
    nav.beginScroll(1, 0, 0, 0);
    for (let t = 8; t <= 80; t += 8) nav.move(1, 0, -t, t);
    const fast = nav.end(1, 82);
    expect(fast.vy).toBeLessThan(-0.5);
    nav.beginScroll(1, 0, 0, 0);
    nav.move(1, 0, -10, 8);
    expect(nav.end(1, 200)).toEqual({ vx: 0, vy: 0 });
    const g = glide(-1, 2000);
    expect(g.distance).toBeLessThan(-150);
    expect(Math.abs(g.speed)).toBeLessThan(0.0001);
  });
});
