// Settings, then On-device intelligence, then Models: a language model, the meaning model, and translation packs are
// listed with their sizes, nothing downloads before the person agrees, and what is downloaded can be removed. The web
// build downloads nothing from a network: its models "arrive" in seconds, so the screens can be tried in a browser.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { openMembranes, runCommand, startWith } from '../intel';

async function openModels(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await page.keyboard.press('Control+Comma');
  await page
    .getByRole('navigation', { name: 'Settings sections' })
    .getByRole('link', { name: 'On-device intelligence' })
    .click();
  await expect(page.getByRole('heading', { level: 2, name: 'Models' })).toBeVisible();
}

const row = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name }).first();

test('lists every kind of model with its size, and downloads nothing until asked', async ({ page }) => {
  await openModels(page);
  for (const heading of ['Speech to text', 'Ask and the writing tools', 'Find by meaning', 'Translation packs']) {
    await expect(page.getByRole('heading', { level: 3, name: heading })).toBeVisible();
  }
  const small = row(page, 'Writing and Ask, small');
  await expect(small).toContainText('491.4 MB');
  await expect(small).toContainText('Not downloaded');
  await expect(row(page, 'English to Spanish')).toContainText('119 MB');
  await expect(row(page, 'English to Spanish')).toContainText('Not downloaded');
});

test('a language model downloads after the size is shown, becomes the one in use, and can be removed', async ({
  page,
}) => {
  await openModels(page);
  const small = row(page, 'Writing and Ask, small');
  await small.getByRole('button', { name: /^Download Writing and Ask, small/ }).click();
  const ask = page.getByRole('dialog', { name: 'Download Writing and Ask, small?' });
  await expect(ask).toContainText('491.4 MB');
  await ask.getByRole('button', { name: 'Not now' }).click();
  await expect(small).toContainText('Not downloaded');

  await small.getByRole('button', { name: /^Download Writing and Ask, small/ }).click();
  await page
    .getByRole('dialog', { name: 'Download Writing and Ask, small?' })
    .getByRole('button', { name: 'Download' })
    .click();
  await expect(small.getByText('Downloaded', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(small.getByText('In use')).toBeVisible();

  await small.getByRole('button', { name: 'Remove Writing and Ask, small' }).click();
  await page
    .getByRole('dialog', { name: 'Remove Writing and Ask, small?' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(small).toContainText('Not downloaded');
});

test('with a language model downloaded, a writing suggestion says the model wrote it', async ({ page }) => {
  await openModels(page);
  const small = row(page, 'Writing and Ask, small');
  await small.getByRole('button', { name: /^Download Writing and Ask, small/ }).click();
  await page
    .getByRole('dialog', { name: 'Download Writing and Ask, small?' })
    .getByRole('button', { name: 'Download' })
    .click();
  await expect(small.getByText('Downloaded', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('switch', { name: 'Writing tools' }).click();
  await expect(page.getByRole('switch', { name: 'Writing tools' })).toHaveAttribute('aria-checked', 'true');

  // The web build remembers the download, so after a reload the model is still there and takes over.
  await openMembranes(page);
  const box = page.getByRole('textbox', { name: 'Text' });
  await box.click();
  await page.keyboard.type('the cells make make energy');
  await page.keyboard.press('Control+KeyA');
  await runCommand(page, 'Proofread');
  const suggestion = page.getByRole('dialog', { name: 'Proofread' });
  await expect(suggestion).toContainText('Suggested by the language model on this device.');
  await expect(suggestion).toContainText('the');
  await suggestion.getByRole('button', { name: 'Cancel' }).click();
});

test('without a model, a writing suggestion says the built-in rules wrote it', async ({ page }) => {
  await startWith(page, []);
  await openMembranes(page);
  const box = page.getByRole('textbox', { name: 'Text' });
  await box.click();
  await page.keyboard.type('the cells make make energy');
  await page.keyboard.press('Control+KeyA');
  await runCommand(page, 'Proofread');
  await page.getByRole('dialog', { name: 'Turn on writing tools?' }).getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByRole('dialog', { name: 'Proofread' })).toContainText('Suggested by the built-in rules.');
});
