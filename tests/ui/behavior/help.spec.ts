// Settings, then Help, in the production build: the version, the self-check that runs on opening, and the
// "Check OpenNote" command in the palette. The check changes nothing and every status is a word.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

async function openHelp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await page.keyboard.press('Control+KeyK');
  const box = page.getByRole('combobox', { name: 'Search commands and pages' });
  await box.pressSequentially('check opennote', { delay: 10 });
  await page.getByRole('option', { name: /Check OpenNote/ }).click();
}

test('Check OpenNote in the palette opens Help and runs the self-check', async ({ page }) => {
  await openHelp(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Help' })).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Everything is in order.' })).toBeVisible();
  await expect(page.getByText(/^Version /)).toBeVisible();
  const check = page.getByRole('region', { name: 'Self-check' });
  for (const row of ['Space for your notes', 'Saving in the notebook folder', 'The notebook', 'Updates']) {
    await expect(check.getByText(row, { exact: true })).toBeVisible();
  }
  await expect(check.getByText('OK', { exact: true })).toHaveCount(7);
  await expect(page.getByText('9 of the last 10 sessions ended without a crash.')).toBeVisible();
});

test('Check again runs the check again, and the page has a way on to feedback and Privacy', async ({ page }) => {
  await openHelp(page);
  const headline = page.getByRole('status').filter({ hasText: 'Everything is in order.' });
  await expect(headline).toBeVisible();
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(headline).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send feedback' })).toBeVisible();
  await page.getByRole('button', { name: 'Privacy' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeFocused();
});
