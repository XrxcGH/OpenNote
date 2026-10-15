// Settings, Connectors in the production build: a connector with a client ID shows Sign in, and one without says it
// needs setup.

import { expect, test } from '../fixtures';

async function openConnectors(page: import('@playwright/test').Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await expect(page.getByText('Biology 101')).toBeVisible();
  await page.keyboard.press('Control+Comma');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Connectors' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Connectors' })).toBeFocused();
}

test('a connector without a client ID says Needs setup and offers no Connect', async ({ page }) => {
  await openConnectors(page, '');
  const google = page.getByRole('article', { name: /Google/ }).first();
  await expect(google.getByText('Needs setup')).toBeVisible();
  await expect(google.getByRole('button', { name: /^Connect( |$)/ })).toHaveCount(0);
});

test('a connector with a client ID offers Connect (sign in) instead of Needs setup', async ({ page }) => {
  await openConnectors(page, '?connectors=ready');
  const google = page.getByRole('article', { name: /Google/ }).first();
  await expect(google.getByRole('button', { name: /^Connect( |$)/ })).toBeVisible();
  await expect(page.getByText('Needs setup')).toHaveCount(0);
});
