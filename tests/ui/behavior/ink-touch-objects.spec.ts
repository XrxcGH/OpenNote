// Beta 6 owner bugs 5 and 8: what is selected, and text boxes, while a draw tool is active. Pen and touch input go
// through the DevTools Protocol.
// - A drag on the lasso frame moves only the selection with the pen, a finger, or the mouse. The browser never starts
//   a pan of its own, so the page and the window stay put.
// - A held pen tap, a finger tap, or the lasso selects a text box. The frame then moves, resizes, edits, and deletes
//   it, without leaving the pen tool and without stray ink.
import type { CDPSession, Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { choose, draw, ellipse, heldStrokes, line, openPage } from '../ink';

interface Point {
  x: number;
  y: number;
}

test.use({ hasTouch: true });

const steps = (from: Point, to: Point, count = 10): Point[] =>
  Array.from({ length: count }, (_, i) => ({
    x: from.x + ((to.x - from.x) * (i + 1)) / count,
    y: from.y + ((to.y - from.y) * (i + 1)) / count,
  }));

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A pen press at `from`, held for `hold` ms, dragged to `to`, and lifted. */
async function pen(client: CDPSession, from: Point, to: Point = from, hold = 0): Promise<void> {
  const send = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', at: Point, buttons: number) =>
    client.send('Input.dispatchMouseEvent', {
      type,
      x: at.x,
      y: at.y,
      button: 'left',
      buttons,
      clickCount: 1,
      pointerType: 'pen',
      force: 0.5,
    });
  await send('mousePressed', from, 1);
  if (hold > 0) await pause(hold);
  if (to.x !== from.x || to.y !== from.y) for (const at of steps(from, to)) await send('mouseMoved', at, 1);
  await send('mouseReleased', to, 0);
}

/** One finger pressed at `from`, held for `hold` ms, dragged to `to`, and lifted. */
async function finger(client: CDPSession, from: Point, to: Point = from, hold = 0): Promise<void> {
  const touch = (type: 'touchStart' | 'touchMove', at: Point) =>
    client.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [{ x: at.x, y: at.y, id: 1, radiusX: 4, radiusY: 4 }],
    });
  await touch('touchStart', from);
  if (hold > 0) await pause(hold);
  if (to.x !== from.x || to.y !== from.y) for (const at of steps(from, to)) await touch('touchMove', at);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Records every pointercancel, which the browser sends when it takes a touch or pen drag for a pan of its own. */
function watchCancels(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = window as unknown as { cancels: number };
    w.cancels = 0;
    window.addEventListener('pointercancel', () => (w.cancels += 1), true);
  });
}

const cancels = (page: Page) => page.evaluate(() => (window as unknown as { cancels: number }).cancels);

/** How far every scroller on the screen is scrolled, the window's own scroller included. */
const scrolled = (page: Page) =>
  page.evaluate(() =>
    [document.scrollingElement!, ...document.querySelectorAll('*')]
      .filter((element) => element.scrollTop !== 0 || element.scrollLeft !== 0)
      .map((element) => `${element.className}:${element.scrollLeft},${element.scrollTop}`),
  );

/** The transforms the web platform's page service holds for the page's strokes. */
const transforms = (page: Page) =>
  page.evaluate(() => {
    const hooks = (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__;
    const held = hooks.pagesHeld() as { memoryInk?: Record<string, { transform?: number[] }> };
    return Object.values(held.memoryInk ?? {}).map((stroke) => stroke.transform ?? null);
  });

const frame = (page: Page) => page.getByRole('group', { name: 'Selected ink and text' });

/**
 * A text box by its block, since a box's name (Text box 2 of 8) follows its place in reading order and changes as it
 * moves.
 */
async function textBox(page: Page, name: RegExp) {
  const id = await page
    .getByRole('textbox', { name })
    .evaluate((element) => element.closest('[data-block-id]')!.getAttribute('data-block-id'));
  return page.locator(`[data-block-id="${id}"] [role="textbox"]`);
}
/**
 * The frame the web platform's page service holds for a text box's block: what the core accepted, not the view's
 * own guess, which shows a move or resize before the core answers and takes it back if the core refuses.
 */
async function heldFrame(page: Page, target: Locator): Promise<{ x: number; y: number; w?: number } | null> {
  const id = await blockId(target);
  return page.evaluate((block) => {
    const hooks = (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__;
    const held = hooks.pagesHeld() as { blocks: { id: string; frame?: { x: number; y: number; w?: number } }[] };
    return held.blocks.find((each) => each.id === block)?.frame ?? null;
  }, id);
}

const textBoxes = (page: Page) => page.locator('[role="textbox"][aria-label^="Text box"]');

for (const kind of ['pen', 'finger', 'mouse'] as const) {
  test(`drags a lasso selection with the ${kind} and moves nothing else`, async ({ page }) => {
    await openPage(page);
    await choose(page, 'Pen, Ink, 0.5 mm');
    await draw(page, line([150, 350], [400, 380]));
    await expect.poll(async () => (await heldStrokes(page)).length).toBe(1);
    await choose(page, 'Lasso select');
    await draw(page, ellipse(275, 365, 220, 90));
    await expect(frame(page)).toBeVisible();
    const box = (await frame(page).boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const to = { x: from.x + 80, y: from.y + 60 };
    const before = await scrolled(page);
    await watchCancels(page);
    const client = await page.context().newCDPSession(page);
    if (kind === 'pen') await pen(client, from, to);
    else if (kind === 'finger') await finger(client, from, to);
    else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 10 });
      await page.mouse.up();
    }
    await expect.poll(() => transforms(page)).toEqual([[1, 0, 0, 1, 80, 60]]);
    expect(await cancels(page)).toBe(0);
    expect(await scrolled(page)).toEqual(before);
    expect(await heldStrokes(page)).toHaveLength(1);
  });
}

/** The freeform page with eight text boxes, open in the Draw tab with the pen chosen, and a DevTools session on it. */
async function freeformWithPen(page: Page): Promise<CDPSession> {
  await page.goto('/?fixture=freeform8');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByRole('textbox', { name: /^Text box 2 / })).toBeVisible();
  await page.getByRole('tab', { name: 'Draw' }).click();
  await choose(page, 'Pen, Ink, 0.5 mm');
  return page.context().newCDPSession(page);
}

test('a held pen tap selects a text box, which the frame moves, resizes, edits, and deletes', async ({ page }) => {
  const client = await freeformWithPen(page);
  const target = await textBox(page, /^Text box 2 /);
  const start = (await target.boundingBox())!;
  const held = (await heldFrame(page, target))!;
  await pen(client, { x: start.x + 20, y: start.y + start.height / 2 }, undefined, 400);
  await expect(frame(page)).toBeVisible();
  expect(await heldStrokes(page)).toHaveLength(0);
  // Only what acts on a text box shows: Delete does, Recolor (ink alone) does not.
  await expect(page.getByRole('button', { name: 'Delete the selection' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recolor the selection' })).toBeHidden();

  // Move it with the pen.
  const around = (await frame(page).boundingBox())!;
  const middle = { x: around.x + around.width / 2, y: around.y + around.height / 2 };
  await pen(client, middle, { x: middle.x + 60, y: middle.y + 40 });
  await expect.poll(async () => (await target.boundingBox())!.x).toBeCloseTo(start.x + 60, 0);
  expect((await target.boundingBox())!.y).toBeCloseTo(start.y + 40, 0);
  // The core holds the move, at the page's zoom of 1.
  await expect.poll(() => heldFrame(page, target)).toMatchObject({ x: held.x + 60, y: held.y + 40 });

  // Resize it from a corner with the pen.
  const moved = (await target.boundingBox())!;
  const corner = (await page.locator('[data-ink-corner="se"]').boundingBox())!;
  const grab = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 };
  await pen(client, grab, { x: grab.x + 80, y: grab.y + 20 });
  await expect.poll(async () => (await target.boundingBox())!.width).toBeGreaterThan(moved.width + 40);
  await expect.poll(async () => (await heldFrame(page, target))?.w ?? 0).toBeGreaterThan((held.w ?? 0) + 40);

  // A tap inside puts the caret in its text, and typing goes in.
  const now = (await target.boundingBox())!;
  await pen(client, { x: now.x + 10, y: now.y + now.height / 2 });
  await expect(target).toBeFocused();
  await expect(frame(page)).toBeHidden();
  await page.keyboard.type('Q');
  await expect(target).toContainText('Q');
  expect(await heldStrokes(page)).toHaveLength(0);

  // The width handle of the box being edited resizes it with the pen, without ink.
  const wide = (await target.boundingBox())!;
  const wideHeld = (await heldFrame(page, target))!;
  const handle = (await page.locator('[data-handle="width"]').boundingBox())!;
  const edge = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  await pen(client, edge, { x: edge.x - 60, y: edge.y });
  await expect.poll(async () => (await target.boundingBox())!.width).toBeLessThan(wide.width - 30);
  await expect.poll(async () => (await heldFrame(page, target))?.w ?? Infinity).toBeLessThan((wideHeld.w ?? 0) - 30);
  expect(await heldStrokes(page)).toHaveLength(0);

  // A box resized by its handle stays selected, and the Delete key deletes it.
  await expect(frame(page)).toBeVisible();
  const count = await textBoxes(page).count();
  await page.keyboard.press('Delete');
  await expect(textBoxes(page)).toHaveCount(count - 1);
  expect(await heldStrokes(page)).toHaveLength(0);
});

test('a quick pen tap on a text box stays a dot', async ({ page }) => {
  const client = await freeformWithPen(page);
  const box = (await page.getByRole('textbox', { name: /^Text box 2 / }).boundingBox())!;
  await pen(client, { x: box.x + 20, y: box.y + box.height / 2 });
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(1);
  await expect(frame(page)).toBeHidden();
});

test('a finger tap selects a text box once the pen is in use, and the bar deletes it', async ({ page }) => {
  const client = await freeformWithPen(page);
  const target = await textBox(page, /^Text box 2 /);
  const box = (await target.boundingBox())!;
  const held = (await heldFrame(page, target))!;
  // Writing with the pen first, on empty page below the box, so a finger no longer draws.
  const empty = { x: box.x + box.width + 20, y: box.y + box.height + 60 };
  await pen(client, empty, { x: empty.x + 80, y: empty.y + 10 });
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(1);
  const count = await textBoxes(page).count();
  await finger(client, { x: box.x + 20, y: box.y + box.height / 2 });
  await expect(frame(page)).toBeVisible();
  // A finger drags it too, and the page does not pan.
  const before = await scrolled(page);
  const around = (await frame(page).boundingBox())!;
  const middle = { x: around.x + around.width / 2, y: around.y + around.height / 2 };
  await finger(client, middle, { x: middle.x + 50, y: middle.y + 30 });
  await expect.poll(async () => (await target.boundingBox())!.x).toBeCloseTo(box.x + 50, 0);
  await expect.poll(() => heldFrame(page, target)).toMatchObject({ x: held.x + 50, y: held.y + 30 });
  expect(await scrolled(page)).toEqual(before);
  await finger(client, await center(page, page.getByRole('button', { name: 'Delete the selection' })));
  await expect(textBoxes(page)).toHaveCount(count - 1);
  expect(await heldStrokes(page)).toHaveLength(1);
});

test('a held finger tap selects a text box while a finger draws, and a lasso tap selects one', async ({ page }) => {
  const client = await freeformWithPen(page);
  const box = (await page.getByRole('textbox', { name: /^Text box 2 / }).boundingBox())!;
  // Held past the tap's moment, short of the long press the palm filter takes for a resting hand.
  await finger(client, { x: box.x + 20, y: box.y + box.height / 2 }, undefined, 350);
  await expect(frame(page)).toBeVisible();
  expect(await heldStrokes(page)).toHaveLength(0);
  await page.keyboard.press('Escape');
  await expect(frame(page)).toBeHidden();
  await choose(page, 'Lasso select');
  const third = (await page.getByRole('textbox', { name: /^Text box 3 / }).boundingBox())!;
  await pen(client, { x: third.x + 20, y: third.y + third.height / 2 });
  await expect(frame(page)).toBeVisible();
  expect(await heldStrokes(page)).toHaveLength(0);
});

/** Whether `element` is the topmost thing at the point, the one a press there lands on. */
const onTop = (element: Locator, at: Point) =>
  element.evaluate((node, [x, y]) => document.elementsFromPoint(x!, y!)[0] === node, [at.x, at.y]);

test('a quick finger tap selects a text box before a pen is seen, and the bar and handles take the finger', async ({
  page,
}) => {
  const client = await freeformWithPen(page);
  // Box 6 sits low enough for the bar to go above it, in the strip where Phase 4's grip was drawn over the buttons.
  const target = await textBox(page, /^Text box 6 /);
  const box = (await target.boundingBox())!;
  const held = (await heldFrame(page, target))!;
  await finger(client, { x: box.x + 20, y: box.y + box.height / 2 });
  await expect(frame(page)).toBeVisible();
  expect(await heldStrokes(page)).toHaveLength(0);
  expect(await page.locator('[data-ink-selection-bar]').getAttribute('data-below')).toBeNull();

  // One chrome per selection: the frame's bar is on top at the middle and the lower edge of its buttons.
  const remove = page.getByRole('button', { name: 'Delete the selection' });
  const bar = (await remove.boundingBox())!;
  for (const y of [bar.y + bar.height / 2, bar.y + bar.height - 1]) {
    expect(await onTop(remove, { x: bar.x + bar.width / 2, y })).toBe(true);
  }
  await expect(page.locator(`[data-handle][data-block="${await blockId(target)}"]`)).toHaveCount(0);

  // A finger a little off a corner's small circle, over the mover, still resizes.
  expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true);
  const corner = page.locator('[data-ink-corner="se"]');
  const at = await center(page, corner);
  const off = { x: at.x - 12, y: at.y - 12 };
  expect(await onTop(corner, off)).toBe(true);
  expect(await onTop(corner, { x: at.x + 20, y: at.y + 20 })).toBe(true);
  await finger(client, off, { x: off.x + 60, y: off.y });
  await expect.poll(async () => (await heldFrame(page, target))?.w ?? 0).toBeGreaterThan((held.w ?? 0) + 30);
  const resized = (await heldFrame(page, target))!;
  expect([resized.x, resized.y]).toEqual([held.x, held.y]);

  // A finger on the lower edge of Delete deletes.
  const count = await textBoxes(page).count();
  const now = (await remove.boundingBox())!;
  await finger(client, { x: now.x + now.width / 2, y: now.y + now.height - 2 });
  await expect(textBoxes(page)).toHaveCount(count - 1);
  expect(await heldStrokes(page)).toHaveLength(0);
});

test('a finger tap in Lasso select selects a text box before a pen is seen', async ({ page }) => {
  const client = await freeformWithPen(page);
  await choose(page, 'Lasso select');
  const box = (await page.getByRole('textbox', { name: /^Text box 3 / }).boundingBox())!;
  await finger(client, { x: box.x + 20, y: box.y + box.height / 2 });
  await expect(frame(page)).toBeVisible();
  expect(await heldStrokes(page)).toHaveLength(0);
});

test('a device that has used a pen starts the next launch with fingers navigating', async ({ page }) => {
  const client = await freeformWithPen(page);
  const box = (await page.getByRole('textbox', { name: /^Text box 2 / }).boundingBox())!;
  const empty = { x: box.x + box.width + 20, y: box.y + box.height + 60 };
  // The pen hovers, and the app is opened again.
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...empty, buttons: 0, pointerType: 'pen' });
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('opennote.ink.palmLearned') ?? '{}').penSeen))
    .toBe(true);
  const again = await freeformWithPen(page);
  await finger(again, empty, { x: empty.x + 80, y: empty.y + 10 });
  await pause(300);
  expect(await heldStrokes(page)).toHaveLength(0);
});

async function blockId(target: Locator): Promise<string | null> {
  return target.evaluate((element) => element.closest('[data-block-id]')!.getAttribute('data-block-id'));
}

async function center(_page: Page, locator: ReturnType<Page['locator']>): Promise<Point> {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
