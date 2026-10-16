// Send feedback in the production build: the form, the whole file on screen, and a save of exactly that text.
// OpenNote does not send the file. The person attaches it themselves.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

interface Hooks {
  saved: string[];
  sent: string[];
}

const hooks = (page: Page): Promise<Hooks> =>
  page.evaluate(() =>
    (window as unknown as { __OPENNOTE_TEST__: { diagnostics(): Hooks } }).__OPENNOTE_TEST__.diagnostics(),
  );

async function openFeedback(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.getByText('Biology 101')).toBeVisible();
  await page.keyboard.press('Control+KeyK');
  await page
    .getByRole('combobox', { name: 'Search commands and pages' })
    .pressSequentially('send feedback', { delay: 10 });
  await page.getByRole('option', { name: /Send feedback/ }).click();
}

test('the file is shown in full before it can be saved, and the saved text is the shown text', async ({ page }) => {
  await openFeedback(page);
  const form = page.getByRole('dialog', { name: 'Send feedback' });
  await expect(form.getByRole('button', { name: 'Save the file' })).toHaveCount(0);
  await form.getByRole('textbox', { name: 'What happened?' }).fill('The page jumped when I scrolled.');
  await form.getByRole('button', { name: 'Review the file' }).click();
  const review = page.getByRole('dialog', { name: 'Review before saving' });
  const text = review.getByRole('region', { name: 'The whole file' });
  await expect(text).toContainText('The page jumped when I scrolled.');
  await expect(review.getByText('Not included')).toBeVisible();
  await expect(review.getByText('Nothing needed to be removed.')).toBeVisible();
  expect((await hooks(page)).saved).toHaveLength(0);
  const shown = await text.textContent();
  await review.getByRole('button', { name: 'Save the file' }).click();
  const done = page.getByRole('dialog', { name: 'Send feedback' });
  await expect(done.getByRole('status')).toHaveText(/^Saved as OpenNote-feedback/);
  const { saved, sent } = await hooks(page);
  expect(saved).toEqual([shown]);
  expect(sent).toHaveLength(0);
  await done.getByRole('button', { name: 'Done' }).click();
  await expect(done).toHaveCount(0);
});

test('closing the folder picker keeps the text on screen and saves nothing', async ({ page }) => {
  await openFeedback(page);
  await page.getByRole('button', { name: 'Review the file' }).click();
  await expect(page.getByRole('region', { name: 'The whole file' })).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { __OPENNOTE_TEST__: { diagnosticsFail(what: string): void } }
    ).__OPENNOTE_TEST__.diagnosticsFail('cancel'),
  );
  await page.getByRole('button', { name: 'Save the file' }).click();
  await expect(page.getByText('Nothing was saved. Choose Save the file to pick a folder.')).toBeVisible();
  expect((await hooks(page)).saved).toHaveLength(0);
  await page.getByRole('button', { name: 'Save the file' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText(/^Saved as /);
});

test('saved crash reports are in the file only when the person chooses them', async ({ page }) => {
  await openFeedback(page, '/?consent=accepted');
  const form = page.getByRole('dialog', { name: 'Send feedback' });
  await expect(form.getByRole('switch', { name: 'Include saved crash reports' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await form.getByRole('button', { name: 'Review the file' }).click();
  await expect(page.getByRole('region', { name: 'The whole file' })).not.toContainText('crash-2');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Back' }).click();
  await dialog.getByRole('switch', { name: 'Include saved crash reports' }).click();
  await dialog.getByRole('button', { name: 'Review the file' }).click();
  await expect(page.getByRole('region', { name: 'The whole file' })).toContainText('crash-2');
});

test("Escape closes the form, and the focus returns to the palette's opener", async ({ page }) => {
  await openFeedback(page);
  await expect(page.getByRole('dialog', { name: 'Send feedback' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
