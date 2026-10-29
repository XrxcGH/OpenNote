// Settings, then On-device intelligence: every feature starts off, says it runs on this device, and a choice
// survives a reload.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

async function openSection(page: Page): Promise<void> {
  await page.keyboard.press('Control+Comma');
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('link', { name: 'On-device intelligence' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'On-device intelligence' })).toBeFocused();
}

test('every feature starts off, and a choice survives a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await openSection(page);
  await expect(page.getByText(/Nothing is sent anywhere\. Each one stays off until you turn it on\./)).toBeVisible();
  for (const name of ['Text in images', 'Read aloud', 'Summaries and keywords']) {
    await expect(page.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'false');
  }
  await expect(page.getByText('Runs on this device. Nothing leaves it.').first()).toBeVisible();
  await page.getByRole('switch', { name: 'Text in images' }).click();
  await expect(page.getByRole('switch', { name: 'Text in images' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('On and ready')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Biology 101')).toBeVisible();
  await openSection(page);
  await expect(page.getByRole('switch', { name: 'Text in images' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('switch', { name: 'Read aloud' })).toHaveAttribute('aria-checked', 'false');
});

test('the switches work from the keyboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await openSection(page);
  const summaries = page.getByRole('switch', { name: 'Summaries and keywords' });
  await summaries.focus();
  await page.keyboard.press('Space');
  await expect(summaries).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Space');
  await expect(summaries).toHaveAttribute('aria-checked', 'false');
});
