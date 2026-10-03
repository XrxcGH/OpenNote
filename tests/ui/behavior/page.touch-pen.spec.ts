// Touch and pen on a freeform page (Phase 4 ARCHITECTURE.md section 26.3, page.touch-pen), on the web build with
// touch and pen input sent through the DevTools Protocol. A tap places the caret, a one-finger drag pans without
// making anything, a pinch zooms, and a pen drag on empty page draws a marquee and never pans. Long presses need
// Windows' own gesture recognizer, so the desktop version and the manual checklist cover them.

import type { CDPSession, Page } from '@playwright/test';
import { expect, test } from '../fixtures';

interface Point {
  x: number;
  y: number;
}

/** How far the page is scrolled: its nearest scrolling ancestor's offsets. */
function scrolled(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    let element: HTMLElement | null = document.querySelector<HTMLElement>('h1[data-page-title]');
    while (element && element.scrollHeight <= element.clientHeight) element = element.parentElement;
    return [element?.scrollLeft ?? 0, element?.scrollTop ?? 0];
  });
}

/** The page's world: where it sits on screen and its scale. */
function world(page: Page): Promise<{ left: number; top: number; scale: number }> {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('h1[data-page-title]')!.parentElement!.parentElement!;
    const box = element.getBoundingClientRect();
    return { left: box.left, top: box.top, scale: box.width / element.offsetWidth };
  });
}

const boxes = (page: Page) => page.locator('[role="textbox"][aria-label^="Text box"]').count();

async function touch(
  client: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: Point[],
): Promise<void> {
  await client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((point, id) => ({ x: point.x, y: point.y, id })),
  });
}

/** Moves one or two fingers in steps from `from` to `to`, then lifts them. */
async function gesture(client: CDPSession, from: Point[], to: Point[], steps = 10): Promise<void> {
  await touch(client, 'touchStart', from);
  for (let step = 1; step <= steps; step += 1) {
    const at = from.map((start, i) => ({
      x: start.x + ((to[i].x - start.x) * step) / steps,
      y: start.y + ((to[i].y - start.y) * step) / steps,
    }));
    await touch(client, 'touchMove', at);
  }
  await touch(client, 'touchEnd', []);
}

async function pen(client: CDPSession, from: Point, to: Point): Promise<void> {
  const send = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', point: Point, buttons: number) =>
    client.send('Input.dispatchMouseEvent', {
      type,
      x: point.x,
      y: point.y,
      button: 'left',
      buttons,
      clickCount: 1,
      pointerType: 'pen',
    });
  await send('mousePressed', from, 1);
  for (let step = 1; step <= 10; step += 1) {
    await send(
      'mouseMoved',
      { x: from.x + ((to.x - from.x) * step) / 10, y: from.y + ((to.y - from.y) * step) / 10 },
      1,
    );
  }
  await send('mouseReleased', to, 0);
}

test.use({ hasTouch: true });

test.describe('touch and pen', () => {
  let client: CDPSession;
  /** An empty spot of the page, below the boxes. */
  let empty: Point;

  test.beforeEach(async ({ page }) => {
    await page.goto('/?fixture=freeform8');
    await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
    await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
    await expect(page.getByRole('textbox', { name: /^Text box 2 / })).toBeVisible();
    client = await page.context().newCDPSession(page);
    const second = (await page.getByRole('textbox', { name: /^Text box 2 / }).boundingBox())!;
    empty = { x: second.x + second.width + 20, y: second.y + second.height + 60 };
  });

  test('a tap places the caret in a text box', async ({ page }) => {
    const target = page.getByRole('textbox', { name: /^Text box 2 / });
    const box = (await target.boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await touch(client, 'touchStart', [at]);
    await touch(client, 'touchEnd', []);
    await expect(target).toBeFocused();
  });

  test('a one-finger drag pans without making anything, and a pinch zooms', async ({ page }) => {
    const count = await boxes(page);
    const before = await world(page);
    await gesture(client, [empty], [{ x: empty.x - 150, y: empty.y - 200 }]);
    await expect.poll(async () => (await world(page)).top).toBeLessThan(before.top - 50);
    expect(await boxes(page)).toBe(count);
    const scale = (await world(page)).scale;
    await gesture(
      client,
      [
        { x: empty.x - 40, y: empty.y },
        { x: empty.x + 40, y: empty.y },
      ],
      [
        { x: empty.x - 160, y: empty.y },
        { x: empty.x + 160, y: empty.y },
      ],
    );
    await expect.poll(async () => (await world(page)).scale).toBeGreaterThan(scale * 1.5);
    expect(await boxes(page)).toBe(count);
  });

  test('a pen drag on empty page draws a marquee and never pans', async ({ page }) => {
    const before = await scrolled(page);
    const second = (await page.getByRole('textbox', { name: /^Text box 2 / }).boundingBox())!;
    await pen(client, empty, { x: second.x + 20, y: second.y + 20 });
    await expect(page.getByText(/^\d+ selected$/)).toBeVisible();
    expect(await scrolled(page)).toEqual(before);
  });
});
