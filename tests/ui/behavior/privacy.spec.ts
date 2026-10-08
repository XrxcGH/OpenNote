// Settings, then Privacy, in the production build: Work offline, the consent screen, and the saved crash reports.
// Nothing is sent without a yes, an address, and a press of Send on text that was on screen.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

interface Hooks {
  calls: string[];
  sent: string[];
  consent: { decision: string };
}

const hooks = (page: Page): Promise<Hooks> =>
  page.evaluate(() =>
    (window as unknown as { __OPENNOTE_TEST__: { diagnostics(): Hooks } }).__OPENNOTE_TEST__.diagnostics(),
  );

async function openPrivacy(page: Page): Promise<void> {
  await expect(page.getByText('Biology 101')).toBeVisible();
  await page.keyboard.press('Control+Comma');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Privacy' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeFocused();
}

test('Work offline blocks every network use, says so in the title bar, and can be turned off there', async ({
  page,
}) => {
  await page.goto('/');
  await openPrivacy(page);
  const uses = page.getByRole('region', { name: 'Network use' });
  await expect(uses.getByText('Update checks')).toBeVisible();
  await expect(uses.getByText('Blocked while you work offline.')).toHaveCount(0);
  await page.getByRole('switch', { name: 'Work offline' }).click();
  await expect(uses.getByText('Blocked while you work offline.')).toHaveCount(3);
  const chip = page.getByRole('button', { name: 'Working offline' });
  await expect(chip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await expect(chip).toBeVisible();
  await chip.click();
  await page.getByRole('button', { name: 'Go online' }).click();
  await expect(chip).toHaveCount(0);
  expect((await hooks(page)).calls.filter((call) => call === 'setWorkOffline')).toHaveLength(2);
});

test('Work offline is already on when the host says so', async ({ page }) => {
  await page.goto('/?offline');
  await expect(page.getByRole('button', { name: 'Working offline' })).toBeVisible();
});

test('crash reports stay off until the consent screen is answered with a yes', async ({ page }) => {
  await page.goto('/');
  await openPrivacy(page);
  const toggle = page.getByRole('switch', { name: 'Save crash reports on this computer' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  const dialog = page.getByRole('dialog', { name: 'Save crash reports on this computer?' });
  await expect(dialog).toBeVisible();
  expect((await hooks(page)).consent.decision).toBe('unasked');
  await dialog.getByRole('button', { name: 'See an example report' }).click();
  await expect(dialog.getByRole('region', { name: 'An example report' })).toContainText('opennote.exe');
  await dialog.getByRole('button', { name: 'Turn on crash reports' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect((await hooks(page)).consent.decision).toBe('accepted');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect((await hooks(page)).consent.decision).toBe('declined');
});

test.describe('on the beta channel', () => {
  test.use({ boot: { channel: 'beta' } });

  test('the consent screen asks once, and Escape is a no that is not asked again', async ({ page }) => {
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: 'Save crash reports on this computer?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep crash reports off' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await hooks(page)).consent.decision).toBe('declined');
    await page.waitForTimeout(1600);
    await expect(dialog).toHaveCount(0);
  });
});

test('a saved report is read in full, then sent once with a press of Send', async ({ page }) => {
  await page.goto('/?consent=accepted');
  await openPrivacy(page);
  await expect(page.getByText('2 crash reports are saved on this computer.')).toBeVisible();
  await page.getByRole('button', { name: 'Review' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Review before sending' });
  const text = dialog.getByRole('region', { name: 'Review before sending' });
  await expect(text).toContainText('0xc0000005');
  await expect(dialog.getByText('It would be sent to https://reports.example.net/v1/crash.')).toBeVisible();
  const shown = await text.textContent();
  expect((await hooks(page)).sent).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Send this report' }).click();
  await expect(dialog.getByText('The report was sent. It is still saved here until you delete it.')).toBeVisible();
  const { sent } = await hooks(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toBe(shown);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('2 crash reports are saved on this computer.')).toBeVisible();
});

test('a report can be deleted, and all of them only after a question', async ({ page }) => {
  await page.goto('/?consent=accepted');
  await openPrivacy(page);
  await page.getByRole('button', { name: 'Delete' }).first().click();
  await expect(page.getByText('1 crash report is saved on this computer.')).toBeVisible();
  await page.getByRole('button', { name: 'Delete all' }).click();
  const question = page.getByRole('dialog', { name: 'Delete all crash reports?' });
  await question.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('1 crash report is saved on this computer.')).toBeVisible();
  await page.getByRole('button', { name: 'Delete all' }).click();
  await question.getByRole('button', { name: 'Delete all' }).click();
  await expect(page.getByText('No crash reports are saved.')).toBeVisible();
});
