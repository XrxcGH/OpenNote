// Safe start in the production build. After two crashes in a row the offer shows before the notebook opens, with
// two buttons of the same weight. Escape starts normally. A yes shows "safe mode" in words in the title bar.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

const calls = (page: Page): Promise<string[]> =>
  page.evaluate(
    () =>
      (
        window as unknown as { __OPENNOTE_TEST__: { diagnostics(): { calls: string[] } } }
      ).__OPENNOTE_TEST__.diagnostics().calls,
  );

test('a clean start offers nothing', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'OpenNote is in safe mode' })).toHaveCount(0);
});

test('two crashes in a row offer safe mode before the notebook opens, and a yes turns the notice on', async ({
  page,
}) => {
  await page.goto('/?crashes=2');
  const dialog = page.getByRole('dialog', { name: 'OpenNote did not close properly' });
  await expect(dialog).toBeVisible();
  await expect(page.getByText('Biology 101')).toHaveCount(0);
  await expect(dialog.getByText('Background work, such as search indexing')).toBeVisible();
  await expect(dialog.getByText('On-device models, such as handwriting recognition')).toBeVisible();
  await dialog.getByRole('button', { name: 'Start in safe mode' }).click();
  await expect(page.getByText('Biology 101')).toBeVisible();
  expect(await calls(page)).toContain('enterSafeMode');
  const chip = page.getByRole('button', { name: 'OpenNote is in safe mode' });
  await chip.click();
  await expect(page.getByText('Embeds, which show their saved preview instead')).toBeVisible();
  await page.getByRole('button', { name: 'Restart normally' }).click();
  await expect.poll(async () => (await calls(page)).includes('restart')).toBe(true);
});

test('Escape starts normally and records nothing', async ({ page }) => {
  await page.goto('/?crashes=2');
  await expect(page.getByRole('dialog', { name: 'OpenNote did not close properly' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Biology 101')).toBeVisible();
  expect(await calls(page)).not.toContain('enterSafeMode');
  await expect(page.getByRole('button', { name: 'OpenNote is in safe mode' })).toHaveCount(0);
});

test('after a crash in safe mode, the offer says safe mode did not help and points to feedback', async ({ page }) => {
  await page.goto('/?crashes=3&safe=1');
  const dialog = page.getByRole('dialog', { name: 'OpenNote stopped again in safe mode' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/send feedback so the cause can be found/)).toBeVisible();
});
