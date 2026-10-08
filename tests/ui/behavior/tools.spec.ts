// The study tool windows (Phase 10): timers, the calculator, and Upcoming open from the palette as dialogs, work
// with the keyboard alone, keep their state on the device, and close with Escape.

import { expect, test } from '../fixtures';
import { openSmart, runCommand } from './smart';

test('runs a countdown timer', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Open timers');
  const dialog = page.getByRole('dialog', { name: 'Timers' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Add timer' }).click();
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog.getByText('Running')).toBeVisible();
  await expect(dialog.getByRole('timer')).toHaveText(/^[45]:\d\d$/);
  await dialog.getByRole('button', { name: 'Pause' }).click();
  await expect(dialog.getByText('Paused')).toBeVisible();
});

test('remembers its timers after the page reloads', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Open timers');
  await page.getByRole('dialog', { name: 'Timers' }).getByRole('button', { name: 'Add timer' }).click();
  await page.reload();
  await openSmart(page);
  await runCommand(page, 'Open timers');
  await expect(page.getByRole('timer', { name: 'Timer 1' })).toHaveText('5:00');
});

test('answers in the calculator, converts units, and explains a mistake', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Open calculator');
  const expression = page.getByRole('textbox', { name: 'Expression' });
  await expression.fill('2pi * 3');
  await page.keyboard.press('Enter');
  await expect(page.locator('#calc-result')).toHaveText('= 18.8495559215');
  await expression.fill('5 km to mi');
  await page.keyboard.press('Enter');
  await expect(page.locator('#calc-result')).toHaveText('= 3.10685596119');
  await expression.fill('1 / 0');
  await page.keyboard.press('Enter');
  await expect(page.locator('#calc-result')).toHaveText('Dividing by zero has no answer.');
});

test('graphs in the calculator’s Graphing tab', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Open calculator');
  await page.getByRole('tab', { name: 'Graphing' }).click();
  await expect(page.getByRole('application', { name: /^Graph of 1 function/ })).toBeVisible();
});

test('puts a calculator answer into the page', async ({ page }) => {
  await openSmart(page);
  await page.getByRole('textbox', { name: 'Text' }).first().click();
  await runCommand(page, 'Open calculator');
  await page.getByRole('textbox', { name: 'Expression' }).fill('6 * 7');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Insert answer into page' }).click();
  await expect(page.getByRole('textbox', { name: 'Text' }).first()).toContainText('42');
});

test('files a task under the date it finds and checks it off', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Open upcoming');
  const dialog = page.getByRole('dialog', { name: 'Upcoming' });
  await dialog.getByLabel('Task and when it is due').fill('Read chapter 4 today 5 PM');
  await dialog.getByRole('button', { name: 'Add a task' }).click();
  await expect(dialog.getByRole('heading', { name: /Today|Overdue/ })).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Done: Read chapter 4' }).click();
  await expect(dialog.getByText('Read chapter 4', { exact: true })).toHaveCount(0);
});

test('closes with Escape and moves from its title with the arrow keys', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Open upcoming');
  const dialog = page.getByRole('dialog', { name: 'Upcoming' });
  const before = await dialog.boundingBox();
  await dialog.getByLabel(/^Move Upcoming/).press('ArrowLeft');
  expect((await dialog.boundingBox())!.x).toBe(before!.x - 16);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
