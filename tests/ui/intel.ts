// Helpers for the on-device intelligence specs. The web platform keeps the person's choices in this browser's
// storage, so a spec turns features on by writing them before the page loads, as a returning person would have.

import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export type Feature = 'ocr' | 'handwriting' | 'readAloud' | 'summaries';

const KEY = 'opennote.intel.choices';

/** Starts the page with these features already on. Everything else stays off. */
export async function startWith(page: Page, on: Feature[]): Promise<void> {
  await page.addInitScript(
    ({ key, features }) => {
      // Only the first load: a reload must show what the app itself saved.
      if (sessionStorage.getItem('intelSeeded')) return;
      sessionStorage.setItem('intelSeeded', '1');
      localStorage.setItem(key, JSON.stringify(Object.fromEntries(features.map((feature) => [feature, true]))));
    },
    { key: KEY, features: on },
  );
}

/** Opens the Membranes page of the sample library, and waits for its text box, which loads after the heading. */
export async function openMembranes(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Page text' })).toBeVisible({ timeout: 30_000 });
}

/**
 * Runs a command by name from the palette. The palette lists the commands that apply when it opens, so a command
 * that registers a moment later, or a page that is still loading, is found by opening the palette again.
 */
export async function runCommand(page: Page, name: string): Promise<void> {
  const option = page.getByRole('option', { name: new RegExp(name, 'i') }).first();
  for (let attempt = 1; ; attempt += 1) {
    await page.keyboard.press('Control+KeyK');
    const box = page.getByRole('combobox', { name: 'Search commands and pages' });
    await expect(box).toBeFocused();
    await box.fill(name);
    try {
      await option.waitFor({ timeout: 8000 });
      break;
    } catch (error) {
      if (attempt === 4) throw error;
      await page.keyboard.press('Escape');
      await expect(box).toHaveCount(0);
    }
  }
  await option.click();
}
