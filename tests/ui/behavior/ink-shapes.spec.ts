// Shape recognition on the web platform: with Ink to shape on, a rough rectangle is stored as an exact one; with it
// off, the rectangle stays as drawn. A line made into a curve shows its points and handles; dragging a handle bends it,
// points can be added, removed, and made smooth or a corner, each undoes, and the curve is still a curve when the page
// is opened again.
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { choose, draw, ellipse, heldStrokes, line, openPage, undo } from '../ink';
import { drawControl, press, storedStrokes } from '../paperSnap';

// The Draw tab keeps Ink to shape on the bar only when the window is wide; narrower, it sits under More.
test.use({ viewport: { width: 1920, height: 900 } });
// Shapes come from Ink to shape when the pen lifts. Hold to shape is off: the pen events come through the DevTools
// Protocol one at a time, and a busy moment between two of them would read as the pen held still.
test.use({ boot: { settings: { ink: { shapes: { hold: false, inkToShape: true } } } } as never });

function roughRectangle(dx: number): [number, number][] {
  const corners: [number, number][] = [
    [150 + dx, 300],
    [452 + dx, 303],
    [449 + dx, 452],
    [148 + dx, 449],
    [151 + dx, 302],
  ];
  const path: [number, number][] = [];
  for (let i = 0; i + 1 < corners.length; i++) {
    for (let k = 0; k < 12; k++) {
      const [a, b] = [corners[i], corners[i + 1]];
      path.push([a[0] + ((b[0] - a[0]) * k) / 12 + (k % 2), a[1] + ((b[1] - a[1]) * k) / 12 - (k % 2)]);
    }
  }
  path.push(corners[corners.length - 1]);
  return path;
}

test('turns a rough rectangle into an exact one with Ink to shape, and keeps it freehand with it off', async ({
  page,
}) => {
  await openPage(page);
  await press(page, 'Ink to shape', true);
  await choose(page, 'Pen, Ink, 0.5 mm');
  await draw(page, roughRectangle(0));
  // An exact rectangle is its four corners and the first again.
  await expect.poll(() => heldStrokes(page)).toEqual([expect.objectContaining({ points: 5 })]);
  // Off turns every kind of snapping off, so the next rectangle keeps every point the pen drew.
  await press(page, 'Ink to shape', false);
  await draw(page, roughRectangle(400));
  await expect.poll(async () => (await heldStrokes(page)).map((s) => s.points > 5).sort()).toEqual([false, true]);
});

/** Selects what lies around (cx, cy) with the lasso, and takes the pen back. */
async function lassoAround(page: Page, cx: number, cy: number) {
  await (await drawControl(page, 'Lasso select')).click();
  await draw(page, ellipse(cx, cy, 260, 70));
  await expect(page.getByRole('button', { name: 'Move the selection' })).toBeVisible();
}

test('a line made into a curve bends by its handles, gains and loses points, and stays a curve', async ({ page }) => {
  test.setTimeout(240_000);
  await openPage(page);
  await press(page, 'Ink to shape', true);
  await choose(page, 'Pen, Ink, 0.5 mm');
  await draw(page, line([250, 420], [650, 420]));
  await expect.poll(() => heldStrokes(page)).toEqual([expect.objectContaining({ points: 2 })]);

  await lassoAround(page, 450, 420);
  // The selection bar's Make curve (the Draw tab has one too).
  const bar = page.locator('[data-ink-selection-bar]');
  await bar.getByRole('button', { name: 'Make curve', exact: true }).click();
  // A one-segment curve: its first point twice, then 24 samples.
  await expect.poll(async () => (await heldStrokes(page))[0]?.points).toBe(26);
  const points = page.locator('[data-ink-curve-point]');
  await expect(points).toHaveCount(2);
  await expect(page.locator('[data-ink-curve-arms]')).toHaveCount(1);
  await expect(points.first()).toHaveAccessibleName(/^Curve point 1 of 2/);

  // Dragging the first point's handle down bends the curve below the line it was.
  const flat = (await page.evaluate(storedStrokes))[0].points;
  const handle = page.locator('[data-ink-shape-handle="o0"]');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 160, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.max(...(await page.evaluate(storedStrokes))[0].points.map((p) => p.y)))
    .toBeGreaterThan(flat[0].y + 20);

  // Add a point: it is smooth, as the curve flowed through it. S makes it a corner, and again smooth.
  await bar.getByRole('button', { name: 'Add curve point', exact: true }).click();
  await expect(points).toHaveCount(3);
  await expect.poll(async () => (await heldStrokes(page))[0]?.points).toBe(50);
  const middle = page.locator('[data-ink-curve-point="1"]');
  await middle.focus();
  await expect(middle).toHaveAccessibleName(/smooth$/);
  await page.keyboard.press('s');
  await expect(page.locator('[data-ink-curve-point="1"]')).toHaveAccessibleName(/corner$/);
  await page.keyboard.press('s');
  await expect(page.locator('[data-ink-curve-point="1"]')).toHaveAccessibleName(/smooth$/);

  // Delete takes the point out; undo brings it back.
  await page.locator('[data-ink-curve-point="1"]').focus();
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await heldStrokes(page))[0]?.points).toBe(26);
  await undo(page);
  await expect.poll(async () => (await heldStrokes(page))[0]?.points).toBe(50);

  // Open another page and come back: the stroke read back from the page service is still a curve with three points.
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Mitosis' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mitosis' })).toBeVisible();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
  await expect(page.locator('[data-ink-overlay]')).toHaveCount(1);
  await lassoAround(page, 450, 460);
  await expect(page.locator('[data-ink-curve-point]')).toHaveCount(3);
  await expect(bar.getByRole('button', { name: 'Remove curve point', exact: true })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Make curve', exact: true })).toBeHidden();
});
