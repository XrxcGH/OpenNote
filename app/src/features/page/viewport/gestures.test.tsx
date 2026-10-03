// The router and the page's own gestures in a real browser, through synthetic pointer events: one finger pans after
// the slop and glides after a flick, two fingers pinch around their midpoint, holding the camera stops both, and
// tools claim pointers by priority.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGestureTool, TOUCH_SLOP } from './gestures';
import type { GestureTool } from './gestures';
import { createRouter, registerPointerTool } from './router';
import type { PointerToolDef } from './router';
import { createViewport } from './viewport';
import type { PageViewport } from './viewport';

let host: HTMLElement;
let viewport: PageViewport;
let gestures: GestureTool;
let stopRouter: () => void;
const extra: PointerToolDef[] = [];

function pointer(type: string, init: PointerEventInit): void {
  viewport.viewport.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, ...init }),
  );
}

const touch = (pointerId: number, clientX: number, clientY: number) => ({
  pointerId,
  pointerType: 'touch',
  clientX,
  clientY,
  button: 0,
  buttons: 1,
});

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

/** A finger drags from (x, y) by (dx, dy) in `steps` moves, one per frame. */
async function drag(id: number, x: number, y: number, dx: number, dy: number, steps = 6): Promise<void> {
  pointer('pointerdown', touch(id, x, y));
  for (let i = 1; i <= steps; i += 1) {
    pointer('pointermove', touch(id, x + (dx * i) / steps, y + (dy * i) / steps));
    await frame();
  }
}

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: '400px', height: '300px' });
  viewport = createViewport(host, { viewport: '', world: '', underlay: '' });
  viewport.setContent({ w: 3000, h: 3000 });
  gestures = createGestureTool(viewport);
  stopRouter = createRouter({
    element: viewport.viewport,
    camera: () => viewport.camera(),
    toWorld: (x, y) => viewport.toWorld(x, y),
    blockAt: () => null,
    tools: [gestures, ...extra],
  });
  viewport.scrollTo(500, 500);
});

afterEach(() => {
  stopRouter();
  gestures.destroy();
  viewport.destroy();
  host.remove();
  extra.length = 0;
});

describe('touch gestures', () => {
  it('pans with one finger only after the slop', async () => {
    pointer('pointerdown', touch(1, 200, 150));
    pointer('pointermove', touch(1, 200 - (TOUCH_SLOP - 2), 150));
    await frame();
    expect(viewport.viewport.scrollLeft).toBe(500);
    pointer('pointermove', touch(1, 100, 100));
    await frame();
    await frame();
    expect(viewport.viewport.scrollLeft).toBeGreaterThan(590);
    expect(viewport.viewport.scrollTop).toBeGreaterThan(540);
    expect(viewport.camera().gesture).toBe('touchPan');
    pointer('pointerup', touch(1, 100, 100));
  });

  it('keeps panning when the element the finger pressed loses its capture to the viewport', async () => {
    // A real touch starts captured by what it pressed; moving the capture fires lostpointercapture there.
    const pressed = viewport.world.appendChild(document.createElement('p'));
    pointer('pointerdown', touch(1, 200, 150));
    pointer('pointermove', touch(1, 180, 150));
    pressed.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, ...touch(1, 180, 150) }));
    for (const x of [160, 140, 120, 100]) {
      pointer('pointermove', touch(1, x, 150));
      await frame();
    }
    expect(viewport.viewport.scrollLeft).toBeGreaterThan(590);
    expect(viewport.camera().gesture).toBe('touchPan');
    pointer('pointerup', touch(1, 100, 150));
  });

  it('glides after a flick and settles on whole device pixels', async () => {
    await drag(1, 300, 150, -200, 0, 4);
    const lifted = viewport.viewport.scrollLeft;
    pointer('pointerup', touch(1, 100, 150));
    await expect.poll(() => gestures.busy(), { timeout: 2000 }).toBe(false);
    expect(viewport.viewport.scrollLeft).toBeGreaterThan(lifted);
    const dpr = window.devicePixelRatio || 1;
    expect(Math.abs(viewport.camera().scrollX * dpr - Math.round(viewport.camera().scrollX * dpr))).toBeLessThan(0.01);
  });

  it('pinches around the fingers and keeps that point still', async () => {
    const focus = { x: 200, y: 150 };
    const world = viewport.toWorld(focus.x, focus.y);
    pointer('pointerdown', touch(1, 150, 150));
    pointer('pointerdown', touch(2, 250, 150));
    pointer('pointermove', touch(1, 100, 150));
    pointer('pointermove', touch(2, 300, 150));
    await frame();
    await frame();
    expect(viewport.camera().zoom).toBeCloseTo(2, 1);
    expect(viewport.camera().gesture).toBe('pinch');
    const after = viewport.toClient(world.x, world.y);
    expect(after.x).toBeCloseTo(focus.x, 0);
    expect(after.y).toBeCloseTo(focus.y, 0);
    pointer('pointerup', touch(1, 100, 150));
    pointer('pointerup', touch(2, 300, 150));
    await expect.poll(() => gestures.busy()).toBe(false);
    expect(viewport.world.dataset.gesture).toBeUndefined();
  });

  it('ignores pans and pinches while something holds the camera', async () => {
    const release = viewport.holdCamera('pen');
    await drag(1, 300, 150, -150, 0);
    pointer('pointerup', touch(1, 150, 150));
    expect(viewport.viewport.scrollLeft).toBe(500);
    release();
    await drag(2, 300, 150, -150, 0);
    pointer('pointerup', touch(2, 150, 150));
    expect(viewport.viewport.scrollLeft).toBeGreaterThan(500);
  });

  it('pans with the middle mouse button at once', async () => {
    pointer('pointerdown', { pointerId: 5, pointerType: 'mouse', clientX: 200, clientY: 150, button: 1, buttons: 4 });
    pointer('pointermove', { pointerId: 5, pointerType: 'mouse', clientX: 197, clientY: 150, button: -1, buttons: 4 });
    await frame();
    await frame();
    expect(viewport.viewport.scrollLeft).toBe(503);
    pointer('pointerup', { pointerId: 5, pointerType: 'mouse', clientX: 197, clientY: 150, button: 1, buttons: 0 });
  });
});

describe('the pointer router', () => {
  it('lets the highest tool that claims a pointer have it, and cancels the watchers below', () => {
    const calls: string[] = [];
    const tool = (id: string, priority: number, verdict: 'claim' | 'watch'): PointerToolDef => ({
      id,
      priority,
      accepts: (event) => event.pointerType === 'pen',
      down: () => (calls.push(`${id} down`), verdict),
      move: () => (calls.push(`${id} move`), verdict),
      up: () => void calls.push(`${id} up`),
      cancel: () => void calls.push(`${id} cancel`),
    });
    const stopInk = registerPointerTool(tool('ink', 80, 'claim'));
    const stopPalm = registerPointerTool(tool('palm', 100, 'watch'));
    try {
      const reached: string[] = [];
      viewport.world.addEventListener('pointerdown', () => reached.push('down'));
      const pen = { pointerId: 9, pointerType: 'pen', clientX: 50, clientY: 50, button: 0, buttons: 1 };
      const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, ...pen });
      viewport.world.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(reached).toEqual([]);
      pointer('pointermove', pen);
      pointer('pointerup', pen);
      expect(calls).toEqual(['palm down', 'ink down', 'palm cancel', 'ink move', 'ink up']);
    } finally {
      stopInk();
      stopPalm();
    }
  });

  it('hands a watched pointer to the first watcher that claims it on a move', () => {
    const calls: string[] = [];
    const watcher = (id: string, priority: number, claimOnMove: boolean): PointerToolDef => ({
      id,
      priority,
      accepts: (event) => event.pointerType === 'pen',
      down: () => 'watch',
      move: () => (claimOnMove ? 'claim' : 'watch'),
      up: () => void calls.push(`${id} up`),
      cancel: () => void calls.push(`${id} cancel`),
    });
    const stops = [registerPointerTool(watcher('a', 90, false)), registerPointerTool(watcher('b', 85, true))];
    try {
      const pen = { pointerId: 3, pointerType: 'pen', clientX: 50, clientY: 50, button: 0, buttons: 1 };
      pointer('pointerdown', pen);
      pointer('pointermove', pen);
      pointer('pointerup', pen);
      expect(calls).toEqual(['a cancel', 'b up']);
    } finally {
      stops.forEach((stop) => stop());
    }
  });
});
