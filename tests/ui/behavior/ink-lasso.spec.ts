// The lasso on the web platform: it selects ink, the frame moves with the arrow keys, recolors, and deletes.
import { expect, test } from '../fixtures';
import { choose, draw, ellipse, heldStrokes, line, openPage } from '../ink';

test('lassos ink, moves it from the keyboard, recolors it, and deletes it', async ({ page }) => {
  await openPage(page);
  await choose(page, 'Pen, Ink, 0.5 mm');
  await draw(page, line([150, 350], [400, 380]));
  await choose(page, 'Lasso select');
  await draw(page, ellipse(275, 365, 220, 90));
  const frame = page.getByRole('group', { name: 'Selected ink and text' });
  await expect(frame).toBeVisible();
  const move = page.getByRole('button', { name: 'Move the selection' });
  await expect(move).toBeFocused();
  const before = (await frame.boundingBox())!;
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await frame.boundingBox())!.x).toBeGreaterThan(before.x + 5);

  await page.getByRole('button', { name: 'Recolor the selection' }).click();
  await page.getByRole('menuitem', { name: 'Brick' }).click();
  await expect.poll(async () => (await heldStrokes(page))[0]?.palette).toBe(3);

  await page.getByRole('button', { name: 'Delete the selection' }).click();
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(0);
  await expect(frame).toBeHidden();
});
