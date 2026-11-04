// The page's context menu for touch and pen in a real browser: a finger or pen held still on the page raises a
// contextmenu event (Chromium raises none without Windows press and hold), a pen's barrel press that never moves does
// too, a press that moves or a mouse does not, and a native event right after the page's own is dropped.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokens } from '../../../theme/tokens';
import { createSelectTool } from '../pool/selectTool';
import type { EditorPool } from '../pool/pool';
import { createGestureTool } from './gestures';
import { dropDuplicateMenus, requestContextMenu } from './menuRequests';
import { createRouter } from './router';
import { createViewport } from './viewport';
import type { PageViewport } from './viewport';

let host: HTMLElement;
let viewport: PageViewport;
let stopRouter: () => void;
let stopDrop: () => void;
let menus: MouseEvent[];
let taps: number;

const pool = { editor: () => null, mount: () => undefined } as unknown as EditorPool;

function pointer(type: string, init: PointerEventInit): void {
  viewport.viewport.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, ...init }),
  );
}

const press = (pointerType: string, x: number, y: number, button = 0, buttons = 1): PointerEventInit => ({
  pointerId: 1,
  pointerType,
  clientX: x,
  clientY: y,
  button,
  buttons,
});

// One fake clock for the file: the duplicate guard is module-wide and must see time only move forward.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  // The duplicate guard is module-wide: start every test well after the last one.
  vi.advanceTimersByTime(10_000);
  host = document.body.appendChild(document.createElement('div'));
  Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: '400px', height: '300px' });
  viewport = createViewport(host, { viewport: '', world: '', underlay: '' });
  viewport.setContent({ w: 3000, h: 3000 });
  taps = 0;
  stopRouter = createRouter({
    element: viewport.viewport,
    camera: () => viewport.camera(),
    toWorld: (x, y) => viewport.toWorld(x, y),
    blockAt: () => null,
    tools: [
      createGestureTool(viewport),
      createSelectTool(pool, { world: viewport.world, pressEmpty: () => void (taps += 1) }),
    ],
  });
  menus = [];
  host.addEventListener('contextmenu', (event) => menus.push(event));
  stopDrop = dropDuplicateMenus(host);
});

afterEach(() => {
  stopRouter();
  stopDrop();
  host.remove();
});

describe('a touch or pen held still opens the page menu', () => {
  it('raises a contextmenu event for a finger held past the long press time, and drops the tap that follows', () => {
    pointer('pointerdown', press('touch', 100, 100));
    vi.advanceTimersByTime(tokens.interaction.longPressMs - 50);
    expect(menus).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(menus).toHaveLength(1);
    expect(menus[0]?.clientX).toBe(100);
    pointer('pointerup', press('touch', 100, 100, 0, 0));
    expect(taps).toBe(0);
  });

  it('does the same for a pen touching the page', () => {
    pointer('pointerdown', press('pen', 120, 90));
    vi.advanceTimersByTime(tokens.interaction.longPressMs + 20);
    expect(menus).toHaveLength(1);
  });

  it('opens nothing when the finger moves, lifts early, or is a mouse', () => {
    pointer('pointerdown', press('touch', 100, 100));
    pointer('pointermove', press('touch', 130, 100));
    vi.advanceTimersByTime(tokens.interaction.longPressMs + 100);
    expect(menus).toHaveLength(0);
    pointer('pointerup', press('touch', 130, 100, 0, 0));

    pointer('pointerdown', { ...press('touch', 100, 100), pointerId: 2 });
    vi.advanceTimersByTime(100);
    pointer('pointerup', { ...press('touch', 100, 100, 0, 0), pointerId: 2 });
    vi.advanceTimersByTime(tokens.interaction.longPressMs + 100);
    expect(menus).toHaveLength(0);

    pointer('pointerdown', { ...press('mouse', 100, 100), pointerId: 3 });
    vi.advanceTimersByTime(tokens.interaction.longPressMs + 100);
    expect(menus).toHaveLength(0);
  });

  it('opens the menu for a barrel press of a pen that never moved, and not after a barrel pan', () => {
    pointer('pointerdown', press('pen', 100, 100, 2, 2));
    pointer('pointerup', press('pen', 100, 100, 2, 0));
    expect(menus).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    pointer('pointerdown', { ...press('pen', 100, 100, 2, 2), pointerId: 4 });
    pointer('pointermove', { ...press('pen', 160, 140, -1, 2), pointerId: 4 });
    pointer('pointerup', { ...press('pen', 160, 140, 2, 0), pointerId: 4 });
    expect(menus).toHaveLength(1);
  });
});

describe('one press opens one menu', () => {
  it('asks once when the page asks twice in a moment', () => {
    requestContextMenu(document, 50, 50, host);
    requestContextMenu(document, 50, 50, host);
    expect(menus).toHaveLength(1);
  });

  it('lets the page ask after a gap', () => {
    requestContextMenu(document, 50, 50, host);
    vi.advanceTimersByTime(1000);
    requestContextMenu(document, 50, 50, host);
    expect(menus).toHaveLength(2);
  });
});
