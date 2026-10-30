// The aerospace window in the app: opened from the palette, it puts its worked steps on the page as a numbered list
// with inline math, its results as a table, and a plot as an image block. It also fits a narrow window and draws
// in dark mode.
import { expect, test } from '../fixtures';
import { newLine, openSmart, runCommand } from './smart';

test('inserts steps, a result table and a plot into the page', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  const text = page.getByRole('textbox', { name: 'Text' }).first();
  const lists = await text.locator('ol').count();
  const tables = await page.locator('table').count();
  await runCommand(page, 'Open the aerospace tools');
  const dialog = page.getByRole('dialog', { name: 'Aerospace' });
  await expect(dialog.getByRole('button', { name: 'Steps as a list' })).toBeVisible();

  await dialog.getByRole('button', { name: 'Steps as a list' }).click();
  await expect(text.locator('ol')).toHaveCount(lists + 1);
  const steps = text.locator('ol').last().locator('li');
  expect(await steps.count()).toBeGreaterThan(2);
  // Each equation arrives as an inline math node the page draws, not as LaTeX text.
  await expect(steps.locator('[data-math]').first()).toBeVisible();
  await expect(steps.locator('[data-math] .katex').first()).toBeVisible();
  await expect(steps.first()).not.toContainText('\\frac');

  await dialog.getByRole('button', { name: 'Result table' }).click();
  await expect(page.locator('table')).toHaveCount(tables + 1);
  await expect(page.locator('table').last()).toContainText('Temperature');

  await dialog.getByRole('button', { name: 'Plot as picture' }).first().click();
  await expect(
    page.getByRole('img', { name: /^Temperature: Geopotential altitude H, km against Temperature, K/ }).last(),
  ).toBeVisible();
});

test('fits a narrow window and draws in dark mode', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openSmart(page);
  await runCommand(page, 'Open the aerospace tools');
  const dialog = page.getByRole('dialog', { name: 'Aerospace' });
  await expect(dialog.getByRole('button', { name: 'Steps as a list' })).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath('aero-dark.png') });
  await testInfo.attach('aero-dark', { path: testInfo.outputPath('aero-dark.png'), contentType: 'image/png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole('button', { name: 'Steps as a list' })).toBeVisible();
  // Nothing in the window is wider than the window itself.
  const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await dialog.screenshot({ path: testInfo.outputPath('aero-narrow.png') });
  await testInfo.attach('aero-narrow', { path: testInfo.outputPath('aero-narrow.png'), contentType: 'image/png' });
});
