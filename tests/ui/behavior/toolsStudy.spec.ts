// The study tools added in the tools-study lane: Upcoming repeats, its week and month views, the title bar timer
// chip, the dictionary, and the Home Upcoming section.

import { expect, test } from '../fixtures';
import { openSmart, runCommand } from './smart';

test.describe.configure({ timeout: 90_000 });

async function openUpcoming(page: import('@playwright/test').Page) {
  await openSmart(page);
  await runCommand(page, 'Open upcoming');
  return page.getByRole('dialog', { name: 'Upcoming' });
}

test('offers weekday and monthly repeats and reads a typed phrase', async ({ page }) => {
  const dialog = await openUpcoming(page);
  const repeat = dialog.getByLabel('Repeat');
  await expect(repeat.getByRole('option', { name: 'Every weekday' })).toHaveCount(1);
  await expect(repeat.getByRole('option', { name: 'Every month' })).toHaveCount(1);
  await dialog.getByLabel('Task and when it is due').fill('Water plants every weekday');
  await dialog.getByRole('button', { name: 'Add a task' }).click();
  await expect(dialog.getByText('Water plants')).toBeVisible();
  await expect(dialog.getByText(/\(repeats/)).toBeVisible();
});

test('shows Upcoming in a week and a month view', async ({ page }) => {
  const dialog = await openUpcoming(page);
  await dialog.getByLabel('Task and when it is due').fill('Read chapter 4 today');
  await dialog.getByRole('button', { name: 'Add a task' }).click();
  await dialog.getByRole('tab', { name: 'Week' }).click();
  await expect(dialog.getByRole('grid').first()).toBeVisible();
  await dialog.getByRole('tab', { name: 'Month' }).click();
  await expect(dialog.getByRole('grid').first()).toBeVisible();
  await dialog.getByRole('tab', { name: 'List' }).click();
  await expect(dialog.getByText('Read chapter 4', { exact: true })).toBeVisible();
});

test('shows a running timer in the title bar and opens Timers from it', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Open timers');
  const timers = page.getByRole('dialog', { name: 'Timers' });
  await timers.getByRole('button', { name: 'Add timer' }).click();
  await timers.getByRole('button', { name: 'Start' }).click();
  await timers.getByRole('button', { name: 'Close Timers' }).click();
  await expect(timers).toHaveCount(0);
  await page.getByRole('button', { name: /^Timers: .* Open the Timers window\.$/ }).click();
  await expect(page.getByRole('dialog', { name: 'Timers' })).toBeVisible();
});

test('looks a word up in the dictionary', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Open the dictionary');
  const dialog = page.getByRole('dialog', { name: 'Dictionary' });
  await dialog.getByRole('textbox', { name: 'Word' }).fill('happy');
  await expect(dialog.getByRole('heading', { name: 'Adjective' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Insert synonym / }).first()).toBeVisible();
});

test('lists Upcoming on Home', async ({ page }) => {
  await openSmart(page);
  await page.getByRole('toolbar', { name: 'Home' }).getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Upcoming' })).toBeVisible();
});
