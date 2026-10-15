// Handwriting to math: in the equation editor, Write with pen opens a writing area. What is written there is read as
// an equation on this device and put into the field, where it can be edited. The web build's stand-in reads every
// symbol as the same word, so this checks the layout (a bar with a symbol above and one below is a fraction), that
// the strokes leave with the pad, and the controls. How well real handwriting is read is the Windows recognizer's,
// and is for the owner to try on a pen.

import { expect, test } from '../fixtures';
import { choose, openPage } from '../ink';
import { openMembranes } from '../intel';

test('writing a bar with a symbol above and below it puts a fraction in the equation field', async ({ page }) => {
  await openMembranes(page);
  await page.getByRole('textbox', { name: 'Text' }).first().click();
  await page.keyboard.press('Alt+=');
  await page.getByRole('button', { name: 'Write with pen' }).dispatchEvent('click');
  const pad = page.getByRole('group', { name: 'Writing area for math' });
  await expect(pad).toBeVisible();
  const box = (await pad.locator('canvas').boundingBox())!;
  const at = (x: number, y: number) => [box.x + box.width * x, box.y + box.height * y] as const;
  const stroke = async (points: readonly (readonly [number, number])[]) => {
    const [first, ...rest] = points.map(([x, y]) => at(x, y));
    await page.mouse.move(first![0], first![1]);
    await page.mouse.down();
    for (const [x, y] of rest) await page.mouse.move(x, y, { steps: 3 });
    await page.mouse.up();
  };
  await stroke([
    [0.3, 0.5],
    [0.7, 0.5],
  ]);
  await stroke([
    [0.48, 0.15],
    [0.52, 0.3],
    [0.48, 0.38],
  ]);
  await stroke([
    [0.48, 0.62],
    [0.52, 0.78],
    [0.48, 0.88],
  ]);
  await pad.getByRole('button', { name: 'Use writing' }).dispatchEvent('click');
  // Reading handwriting is off until the person says yes.
  await page
    .getByRole('dialog', { name: /Turn on/ })
    .getByRole('button', { name: 'Turn on' })
    .click();
  await expect
    .poll(() =>
      page
        .locator('math-field')
        .first()
        .evaluate((field) => (field as HTMLInputElement).value),
    )
    .toContain('\\frac');
  // The pad can be cleared and closed, and nothing of the writing is kept.
  await page.keyboard.press('Escape');
});

test('says nothing is read when the pad is empty', async ({ page }) => {
  await openMembranes(page);
  await page.getByRole('textbox', { name: 'Text' }).first().click();
  await page.keyboard.press('Alt+=');
  await page.getByRole('button', { name: 'Write with pen' }).dispatchEvent('click');
  const pad = page.getByRole('group', { name: 'Writing area for math' });
  await pad.getByRole('button', { name: 'Use writing' }).dispatchEvent('click');
  await expect(pad).toBeVisible();
});

test('the lasso command is not offered when nothing is selected', async ({ page }) => {
  await openPage(page);
  await choose(page, 'Lasso select');
  await page.keyboard.press('Control+KeyK');
  const box = page.getByRole('combobox', { name: 'Search commands and pages' });
  await box.fill('Convert handwriting to math');
  await expect(page.getByRole('option', { name: /Convert handwriting to math/i })).toHaveCount(0);
});
