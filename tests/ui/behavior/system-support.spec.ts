// macOS and Linux (ADR 0055): the boot payload names the system, so a Mac uses Command for shortcuts, keeps its own
// title bar, and Settings, then About lists what still needs Windows. Show what works on this computer opens it.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

const paletteBox = (page: Page) => page.getByRole('combobox', { name: 'Search commands and pages' });

async function openPalette(page: Page, chord: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  // A press before the app has registered its keys does nothing, so it is pressed until the palette opens.
  await expect(async () => {
    await page.keyboard.press(chord);
    await paletteBox(page).waitFor({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

async function runFromPalette(page: Page, chord: string): Promise<void> {
  await openPalette(page, chord);
  await paletteBox(page).pressSequentially('what works', { delay: 10 });
  await page.getByRole('option', { name: /Show what works on this computer/ }).click();
}

test.describe('on a Mac', () => {
  test.use({ boot: { system: 'macos' } });

  test('Command opens the palette, and the command lists what needs Windows', async ({ page }) => {
    await runFromPalette(page, 'Meta+KeyK');
    await expect(page.getByRole('heading', { level: 2, name: 'What works differently on macOS' })).toBeFocused();
    const facts = page.getByRole('region', { name: 'About OpenNote' });
    await expect(facts.getByText('macOS', { exact: true })).toBeVisible();
    await expect(facts.getByText('WebKit (WKWebView)')).toBeVisible();
    const limits = page.getByRole('region', { name: 'What works differently on macOS' });
    await expect(limits.getByRole('listitem')).toHaveCount(10);
    await expect(limits.getByText(/Saving a page as PDF and printing aren't here yet/)).toBeVisible();
    await expect(limits.getByText(/Download the new dmg/)).toBeVisible();
  });

  test('keeps the native title bar, with no caption buttons of its own', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Biology 101')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Minimize' })).toHaveCount(0);
  });

  test('Control+K is left to the text, and does not open the palette', async ({ page }) => {
    await openPalette(page, 'Meta+KeyK');
    await page.keyboard.press('Escape');
    await expect(paletteBox(page)).toHaveCount(0);
    await page.keyboard.press('Control+KeyK');
    // The palette opens within a frame of the press when a chord matches, so half a second is ample to tell.
    await page.waitForTimeout(500);
    await expect(paletteBox(page)).toHaveCount(0);
  });
});

test.describe('on Linux', () => {
  test.use({ boot: { system: 'linux' } });

  test('Ctrl opens the palette, and the list adds pen pressure', async ({ page }) => {
    await runFromPalette(page, 'Control+KeyK');
    const limits = page.getByRole('region', { name: 'What works differently on Linux' });
    await expect(limits).toBeVisible();
    await expect(limits.getByText(/Pen pressure depends on the desktop/)).toBeVisible();
    await expect(limits.getByText(/Download the new dmg/)).toHaveCount(0);
  });
});

test('on Windows the command stops at the version details, with nothing missing', async ({ page }) => {
  await runFromPalette(page, 'Control+KeyK');
  await expect(page.getByRole('heading', { level: 2, name: 'About OpenNote' })).toBeFocused();
  await expect(page.getByRole('heading', { name: /What works differently/ })).toHaveCount(0);
});
