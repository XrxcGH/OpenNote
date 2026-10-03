// Pens, pencil, and highlighter on the web platform: the Draw tab's pen slots draw, the ink saves to the page
// service, loads back when the page opens again, and undo takes it back.
import { expect, test } from '../fixtures';
import { choose, draw, heldStrokes, inkPixels, line, openPage, undo } from '../ink';

test('draws with a pen, saves the stroke, loads it back, and undoes it', async ({ page }) => {
  await openPage(page);
  await choose(page, 'Pen, Indigo, 0.5 mm');
  await expect(page.getByRole('button', { name: 'Pen, Indigo, 0.5 mm' })).toHaveAttribute('aria-pressed', 'true');
  await draw(page, line([120, 320], [420, 360]));
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(100);
  await expect.poll(() => heldStrokes(page)).toEqual([expect.objectContaining({ tool: 0, palette: 2 })]);

  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Mitosis' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect.poll(() => inkPixels(page)).toBeGreaterThan(100);

  await choose(page, 'Pencil, Walnut, 0.7 mm');
  await draw(page, line([120, 420], [420, 440]));
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(2);
  await undo(page);
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(1);
});

test('draws a highlighter under the pen strokes, in its brand color', async ({ page }) => {
  await openPage(page);
  await choose(page, 'Highlighter, Honey, 4 mm');
  await draw(page, line([120, 320], [420, 320]));
  await expect.poll(() => heldStrokes(page)).toEqual([expect.objectContaining({ tool: 2, palette: 32 })]);
});

test('changes the width and color of the active pen slot', async ({ page }) => {
  await openPage(page);
  await choose(page, 'Pen, Ink, 0.5 mm');
  await page.getByRole('button', { name: 'Width' }).click();
  await page.getByRole('menuitemradio', { name: '1 mm' }).click();
  await expect(page.getByRole('button', { name: 'Pen, Ink, 1 mm' })).toBeVisible();
  await page.getByRole('button', { name: 'Color' }).click();
  await page.getByRole('menuitemradio', { name: 'Fern' }).click();
  await expect(page.getByRole('button', { name: 'Pen, Fern, 1 mm' })).toBeVisible();
});

test('leaves the text under the ink to click and type into with Select and type', async ({ page }) => {
  await openPage(page);
  await choose(page, 'Pen, Ink, 0.5 mm');
  const box = page.getByRole('textbox', { name: 'Text' }).first();
  const at = (await box.boundingBox())!;
  const overlay = (await page.locator('[data-ink-overlay]').boundingBox())!;
  const y = at.y - overlay.y + at.height / 2;
  await draw(page, line([at.x - overlay.x, y], [at.x - overlay.x + 200, y + 40]));
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(1);
  await choose(page, 'Select and type');
  await box.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' under ink');
  await expect(box).toContainText('under ink');
});
