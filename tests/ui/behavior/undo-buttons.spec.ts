// Undo and Redo are title bar buttons: on screen in every tab and in the compact layout, touch-sized, disabled while
// there is nothing to undo, and wired to the same history as Ctrl+Z and Ctrl+Y for ink and for text.
import { expect, test } from '../fixtures';
import { choose, draw, heldStrokes, line, openPage } from '../ink';

test('Undo and Redo buttons undo and redo ink, on every tab', async ({ page }) => {
  await openPage(page);
  const undo = page.getByRole('button', { name: 'Undo', exact: true }).first();
  const redo = page.getByRole('button', { name: 'Redo', exact: true }).first();
  await expect(undo).toBeVisible();
  await expect(redo).toBeVisible();
  await expect(undo).toHaveAttribute('aria-disabled', 'true');
  await expect(redo).toHaveAttribute('aria-disabled', 'true');
  for (const tab of ['Home', 'Insert', 'Draw', 'View']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(undo).toBeVisible();
    const box = (await undo.boundingBox())!;
    expect(Math.min(box.width, box.height), `the Undo button is too small on ${tab}`).toBeGreaterThanOrEqual(32);
  }
  await page.getByRole('tab', { name: 'Draw' }).click();
  await choose(page, 'Pen, Ink, 0.5 mm');
  await draw(page, line([150, 350], [400, 380]));
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(1);
  await expect(undo).not.toHaveAttribute('aria-disabled', 'true');
  await undo.click();
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(0);
  await expect(redo).not.toHaveAttribute('aria-disabled', 'true');
  await redo.click();
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(1);
});

test('the Undo button undoes typing and shows its shortcut in the tooltip', async ({ page }) => {
  await openPage(page);
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type('zebra');
  const undo = page.getByRole('button', { name: 'Undo', exact: true }).first();
  await expect(undo).not.toHaveAttribute('aria-disabled', 'true');
  await undo.click();
  await expect(page.getByText('zebra')).toHaveCount(0);
  await expect(undo).toHaveAttribute('aria-keyshortcuts', 'Control+Z');
  await page.mouse.move(700, 500);
  await undo.hover();
  await expect(page.getByRole('tooltip')).toContainText('Ctrl+Z', { timeout: 4000 });
});

test('the buttons stay on screen in the compact layout', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Undo', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Redo', exact: true }).first()).toBeVisible();
});
