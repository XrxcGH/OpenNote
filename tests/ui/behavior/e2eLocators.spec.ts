// The real-app E2E specs find controls with XPath (tests/e2e/locators.ts) and run only at night. This runs the same
// locators against the web build, so an interface change that breaks one fails the pull request that makes it.

import { expect, test } from '../fixtures';
import type { Page } from '@playwright/test';
import { CALCULATOR_EXPRESSION, RECORDING_GROUP, namedButton, paletteOption } from '../../e2e/locators';

async function openMitosis(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Mitosis' }).click();
  await expect(page.getByRole('textbox', { name: 'Page text' })).toBeVisible();
}

/** Opens the palette, types `search`, and returns once the option for `title` is listed. */
async function offer(page: Page, search: string, title: string) {
  await page.keyboard.press('Control+KeyK');
  await page.getByRole('combobox').fill(search);
  const option = page.locator(`xpath=${paletteOption(title)}`).first();
  await expect(option).toBeVisible();
  return option;
}

test.describe('the locators of the real-app E2E specs', () => {
  test('find the record control by the names a person reads', async ({ page }) => {
    await openMitosis(page);
    for (const name of ['Record', 'Options']) {
      await expect(page.locator(`xpath=${namedButton(RECORDING_GROUP, name)}`)).toHaveCount(1);
    }
  });

  test('find the calculator field, which Escape clears and then closes with', async ({ page }) => {
    await openMitosis(page);
    await (await offer(page, 'calculator', 'Open calculator')).click();
    const field = page.locator(`xpath=${CALCULATOR_EXPRESSION}`);
    await expect(field).toBeVisible();
    await field.fill('1 / 0');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
  });

  test('find the palette options of the commands the specs run', async ({ page }) => {
    await openMitosis(page);
    await offer(page, 'Page history', 'Page history');
    await page.keyboard.press('Escape');
    await page.getByRole('textbox', { name: 'Page text' }).click();
    await offer(page, 'Insert table', 'Insert table');
  });
});
