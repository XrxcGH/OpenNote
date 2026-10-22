// 3D graphs, parametric traces, and the math tool windows (mt3-graph-3d): a 3D graph block draws a surface, turns
// from the keyboard, and keeps the turn in its text; a parametric graph traces its curve; and the Vectors, Solids
// of revolution, and Projectile simulator windows open from the palette and put their results into the page.

import { expect, test } from '../fixtures';
import { newLine, openSmart, runCommand } from './smart';

test('draws a 3D graph from the slash menu and keeps a turn in its text', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.type('/3d graph');
  await expect(page.getByRole('option', { name: 'Insert 3D graph' })).toBeVisible();
  await page.keyboard.press('Enter');
  const plot = page.getByRole('application', { name: '3D graph of 1 item' });
  await expect(plot).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^Tangent plane at \(1, 0\.5, 0\.75\)/)).toBeVisible();
  await plot.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('pre', { hasText: '@angle' }).last()).toContainText('@angle -50 25');
  await page.getByRole('button', { name: 'Contour' }).click();
  await expect(page.locator('pre', { hasText: '@show contour' }).last()).toBeVisible();
});

test('traces a parametric curve from the palette', async ({ page }) => {
  await openSmart(page);
  await page.getByRole('textbox', { name: 'Text' }).first().click();
  await runCommand(page, 'Insert parametric or polar graph');
  await expect(page.getByRole('application', { name: /^Graph of 2 functions/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('slider', { name: 'Trace position, t' }).fill('0');
  await expect(page.getByText('At t = 0: x = 1, y = 0')).toBeVisible();
});

test('works vectors and puts them into the page', async ({ page }) => {
  await openSmart(page);
  await page.getByRole('textbox', { name: 'Text' }).first().click();
  await runCommand(page, 'Open vector tools');
  const dialog = page.getByRole('dialog', { name: 'Vectors' });
  await expect(dialog.getByText('⟨-43, 13, 1⟩')).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Insert into page' }).click();
  await expect(page.getByRole('textbox', { name: 'Text' }).first()).toContainText('a · b = 3');
});

test('finds a volume of revolution', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Open solids of revolution');
  await expect(page.getByRole('dialog', { name: 'Solids of revolution' }).getByText(/Exactly 8π/)).toBeVisible({
    timeout: 20_000,
  });
});

test('flies a projectile', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Open projectile simulator');
  const projectile = page.getByRole('dialog', { name: 'Projectile simulator' });
  await expect(projectile.getByText('Range: 40.77 m')).toBeVisible({ timeout: 20_000 });
  await projectile.getByRole('button', { name: 'Launch' }).click();
  await expect(projectile.getByRole('button', { name: 'Replay' })).toBeVisible();
});
