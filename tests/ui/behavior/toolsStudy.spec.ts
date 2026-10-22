// The study tools added in the tools-study lane: Upcoming repeats, its week-and-month views, the title bar timer
// chip, the dictionary, and the Home Upcoming section.

import { expect, test } from '../fixtures';
import { newLine, openSmart, runCommand } from './smart';

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

test('study tape uncovers on a mouse click, then moves by dragging and by the arrow keys', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await runCommand(page, 'Insert study tape');
  const tape = page.getByRole('button', { name: /study tape/i }).first();
  await expect(tape).toHaveAttribute('aria-pressed', 'true');
  const box = (await tape.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + 8);
  await expect(tape).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(tape).toHaveAttribute('aria-pressed', 'true');
  // A drag moves it and leaves it as it was.
  await page.mouse.move(box.x + 40, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 60, { steps: 6 });
  await page.mouse.move(box.x + 40, box.y + 94, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await tape.boundingBox())!.y - box.y)).toBe(80);
  await expect(tape).toHaveAttribute('aria-pressed', 'true');
  // The arrow keys nudge it.
  const moved = (await tape.boundingBox())!;
  await tape.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Math.round((await tape.boundingBox())!.x - moved.x)).toBe(16);
});

test('turns typed lines into cards, counting a line with a {{blank}}, and opens the deck', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.type('Largest planet :: Jupiter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('The {{heart}} pumps blood');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Boiling point of water :: 100 C');
  await page.waitForTimeout(2500);
  await runCommand(page, 'Open flashcards');
  const window = page.getByRole('dialog', { name: 'Flashcards' });
  await expect(window.getByText(/3 cards/)).toBeVisible();
  await window.getByRole('button', { name: 'Smart notes' }).click();
  await expect(window.getByRole('button', { name: /Back|All decks/ })).toBeVisible();
});
