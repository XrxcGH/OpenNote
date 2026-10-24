// Ctrl+Z on a shown page undoes the page even when focus fell to nothing, as after an undo removed the focused block or
// Convert to table replaced the selection, and never reaches the tree's undo of the page's creation (Beta 5 walk W2-4,
// W2-5). An undone ungroup brings the group back (W2-6).
import { expect, test } from '../fixtures';
import { choose, draw, ellipse, heldStrokes, line, openPage } from '../ink';

test('undoing past the first typing on a new page keeps the page', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  const pages = page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem');
  await pages.first().click();
  const before = await pages.count();
  await page.keyboard.press('Control+n');
  await expect(pages).toHaveCount(before + 1);
  await page.keyboard.press('Enter');
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type('hello world');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Control+z');
  await expect(page.getByText('No page open')).toHaveCount(0);
  await expect(pages).toHaveCount(before + 1);
});

test('Ctrl+Z after Convert to table brings the strokes back', async ({ page }) => {
  await openPage(page);
  await choose(page, 'Pen, Ink, 0.5 mm');
  for (const y of [300, 360, 420]) await draw(page, line([150, y], [450, y]));
  for (const x of [150, 250, 350, 450]) await draw(page, line([x, 300], [x, 420]));
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(7);
  await choose(page, 'Lasso select');
  await draw(page, ellipse(300, 360, 230, 110));
  await page.getByRole('button', { name: 'Convert to table' }).first().click();
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(0);
  const pages = await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem').count();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(7);
  await expect(page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem')).toHaveCount(pages);
});

test('undoing an ungroup brings the group back', async ({ page }) => {
  await openPage(page);
  await choose(page, 'Pen, Ink, 0.5 mm');
  await draw(page, line([150, 300], [400, 300]));
  await draw(page, line([150, 400], [400, 400]));
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(2);
  await choose(page, 'Lasso select');
  await draw(page, ellipse(275, 350, 200, 100));
  const frame = page.getByRole('group', { name: 'Selected ink and text' });
  await expect(frame).toBeVisible();
  await page.keyboard.press('Control+g');
  await expect(page.getByRole('button', { name: 'Ungroup' })).toBeVisible();
  await page.keyboard.press('Control+Shift+G');
  await expect(page.getByRole('button', { name: 'Ungroup' })).toBeHidden();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: 'Ungroup' })).toBeVisible();
  // Lassoing one stroke of the group selects both.
  await page.keyboard.press('Escape');
  await draw(page, ellipse(275, 300, 160, 30));
  await expect.poll(async () => (await frame.boundingBox())?.height ?? 0).toBeGreaterThan(90);
});
