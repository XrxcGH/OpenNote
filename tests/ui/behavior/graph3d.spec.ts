// 3D graphs, parametric traces, and the math tool windows (mt3-graph-3d). A 3D graph block draws a surface and turns
// from the keyboard, keeping the turn in its text. A parametric graph traces its curve. The Vectors, Solids of
// revolution, and Projectile simulator windows open from the palette and put their results into the page.

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

test('saves a 3D graph as SVG and PNG', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.type('/3d graph');
  await expect(page.getByRole('option', { name: 'Insert 3D graph' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('application', { name: '3D graph of 1 item' })).toBeVisible({ timeout: 20_000 });

  const read = async (name: string): Promise<{ file: string; bytes: Buffer }> => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name }).first().click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return { file: download.suggestedFilename(), bytes: Buffer.concat(chunks) };
  };

  const svg = await read('Save as SVG');
  expect(svg.file).toBe('3d-graph.svg');
  const text = svg.bytes.toString('utf8');
  expect(text).toMatch(/^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  expect(text).toContain('<polygon');
  expect(text).toContain('<title>');

  const png = await read('Save as PNG');
  expect(png.file).toBe('3d-graph.png');
  // The PNG signature, then a 2x image of the 3D view.
  expect([...png.bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(png.bytes.length).toBeGreaterThan(2000);
});
