// Opens Settings at one section with the keyboard, for the screens and walks. The shortcut is pressed again until
// the list of sections shows, because a press that comes before the app has registered its keys does nothing, and
// the heading of the page that was already open would otherwise stand for the Settings heading.

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function openSettingsSection(
  page: Page,
  section: string | RegExp,
  list: string | RegExp = 'Settings sections',
): Promise<void> {
  const sections = page.getByRole('navigation', { name: list });
  await expect(async () => {
    await page.keyboard.press('Control+Comma');
    await sections.waitFor({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  const link = sections.getByRole('link', { name: section, exact: typeof section === 'string' });
  if (await link.isVisible()) await link.click();
  await page.getByRole('heading', { level: 1, name: section, exact: typeof section === 'string' }).waitFor();
}
