// Settings, then App permissions, in the production build on the web platform's fake local API: the connected
// app, Revoke, the access log, and the question OpenNote asks before a new app connects.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

async function openAppPermissions(page: Page): Promise<void> {
  await expect(page.getByText('Biology 101')).toBeVisible();
  await page.keyboard.press('Control+Comma');
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('link', { name: 'App permissions' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'App permissions' })).toBeFocused();
}

test('lists the connected app and its log, and revokes it after a yes', async ({ page }) => {
  await page.goto('/?api=demo');
  await openAppPermissions(page);
  await expect(page.getByRole('switch', { name: 'Let apps on this PC connect' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const card = page.getByRole('article', { name: 'opennote' });
  await expect(card.getByText('opennote command')).toBeVisible();
  await expect(card.getByRole('combobox', { name: 'What it can do' })).toHaveValue('read');
  const log = page.getByRole('table', { name: 'Access log' });
  await expect(log.getByText('Refused (locked)')).toBeVisible();

  await card.getByRole('button', { name: 'Revoke opennote' }).click();
  const dialog = page.getByRole('dialog', { name: 'Revoke opennote?' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Revoke' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText(/No apps are connected/)).toBeVisible();
});

test('asks before a new app connects, with no as the first choice', async ({ page }) => {
  await page.goto('/?apiAsk');
  const dialog = page.getByRole('dialog', { name: 'Let My script connect to OpenNote?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Don’t allow' })).toBeFocused();
  await expect(dialog.getByRole('combobox', { name: 'What it can do' })).toHaveValue('read');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
