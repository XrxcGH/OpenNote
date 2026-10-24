// The Settings page, for the focus walk, axe, and the screenshot matrix.

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { defineScreens } from '../screens';

async function openSection(page: Page, name: string): Promise<void> {
  const link = page.getByRole('link', { name, exact: true });
  const heading = page.getByRole('heading', { level: 1, name, exact: true });
  // The key handler is installed late on a slow machine: press again until Settings shows, as the palette steps do.
  await expect(async () => {
    if (await heading.isVisible()) return;
    if (await link.isVisible()) await link.click();
    else await page.keyboard.press('Control+Comma');
    await expect(heading).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

export default defineScreens([
  {
    id: 'settings.general',
    description: 'Settings, General',
    prepare: (page) => openSection(page, 'General'),
  },
  {
    id: 'settings.shortcuts',
    description: 'Settings, Shortcuts, with the shortcut set choice and the list',
    prepare: (page) => openSection(page, 'Shortcuts'),
  },
  {
    id: 'settings.about',
    description: 'Settings, About',
    prepare: (page) => openSection(page, 'About'),
  },
]);
