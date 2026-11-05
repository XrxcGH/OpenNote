// Screenshots of the calm polish (docs/BRAND.md sections 4, 8, and 12): the command bar's icons and pressed states, the
// Draw bar with its pens, the More menu, the notebook's color on the tab strip and the title rule, the plum evening, a
// flat canvas for more contrast, and the forced-colors states. Baselines come only from the update-screenshots
// workflow. Until a picture has a baseline, a normal run skips it and says so, as the matrix does.

import { existsSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../fixtures';
import { skipWithoutBaseline } from '../matrix';
import { loadScreens, openScreen, settle } from '../screens';
import type { ScreenState, Theme } from '../screens';

const screens = await loadScreens();
const byId = (id: string): ScreenState => {
  const screen = screens.find((candidate) => candidate.id === id);
  if (!screen) throw new Error(`No screen state ${id}`);
  return screen;
};

const THEMES: readonly Theme[] = ['light', 'dark'];

function needsBaseline(testInfo: TestInfo, name: string): void {
  const baseline = testInfo.snapshotPath(`${name}.png`);
  test.skip(
    skipWithoutBaseline(testInfo.config.updateSnapshots, existsSync(baseline)),
    'No baseline yet. Run the update-screenshots workflow to take it.',
  );
}

async function start(page: Page, theme: Theme, width = 1280, height = 800): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(
    (appearance) => {
      window.__OPENNOTE_BOOT__ = { settings: { appearance }, bootVersion: 1 } as never;
    },
    { theme },
  );
  await page.setViewportSize({ width, height });
}

async function openMembranes(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
  await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached' });
  await settle(page);
}

const bar = (page: Page) => page.locator('[data-region="commandBar"]').first();

for (const theme of THEMES) {
  test.describe(`polish, ${theme}`, () => {
    for (const [size, width] of [
      ['wide', 1440],
      ['expanded', 1024],
      ['medium', 720],
    ] as const) {
      test(`the Home ribbon at ${size} with Bold pressed`, async ({ page }, testInfo) => {
        const name = `home-ribbon-${size}-${theme}`;
        needsBaseline(testInfo, name);
        await start(page, theme, width, 900);
        await openMembranes(page);
        await page.getByRole('textbox', { name: 'Text' }).click();
        await page.keyboard.press('Control+b');
        await settle(page);
        await expect(bar(page)).toHaveScreenshot(`${name}.png`);
      });
    }

    test('the View ribbon with Notebooks and Pages pressed', async ({ page }, testInfo) => {
      const name = `view-ribbon-${theme}`;
      needsBaseline(testInfo, name);
      await start(page, theme);
      await openMembranes(page);
      await page.getByRole('tab', { name: 'View' }).click();
      await settle(page);
      await expect(bar(page)).toHaveScreenshot(`${name}.png`);
    });

    for (const [width, height, label] of [
      [1280, 800, 'with-pens'],
      [1024, 768, 'pens-in-more'],
    ] as const) {
      test(`the Draw ribbon ${label}`, async ({ page }, testInfo) => {
        const name = `draw-ribbon-${label}-${theme}`;
        needsBaseline(testInfo, name);
        await start(page, theme, width, height);
        await openMembranes(page);
        await page.getByRole('tab', { name: 'Draw' }).click();
        await settle(page);
        await expect(bar(page)).toHaveScreenshot(`${name}.png`);
      });
    }

    test('the More menu with icons at Medium', async ({ page }, testInfo) => {
      const name = `more-menu-medium-${theme}`;
      needsBaseline(testInfo, name);
      await start(page, theme, 720, 900);
      await openMembranes(page);
      await bar(page).getByRole('button', { name: 'More commands' }).click();
      await page.getByRole('menu').waitFor();
      await settle(page);
      await expect(page).toHaveScreenshot(`${name}.png`);
    });

    test('the page title rule in the notebook color', async ({ page }, testInfo) => {
      const name = `title-rule-${theme}`;
      needsBaseline(testInfo, name);
      await start(page, theme);
      await openMembranes(page);
      await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toHaveScreenshot(`${name}.png`);
    });

    test('the empty home screen, the lower third', async ({ page }, testInfo) => {
      const name = `empty-horizon-${theme}`;
      needsBaseline(testInfo, name);
      await openScreen(page, byId('workspace.empty'), { size: 'wide', theme });
      await expect(page).toHaveScreenshot(`${name}.png`, { clip: { x: 0, y: 600, width: 1440, height: 300 } });
    });

    test('setup step 1 with the plum hills and no focus ring', async ({ page }, testInfo) => {
      const name = `setup-welcome-${theme}`;
      needsBaseline(testInfo, name);
      await openScreen(page, byId('setup.welcome'), { size: 'wide', theme });
      await expect(page).toHaveScreenshot(`${name}.png`);
    });

    test('the canvas when the system asks for more contrast', async ({ page }, testInfo) => {
      const name = `more-contrast-${theme}`;
      needsBaseline(testInfo, name);
      await page.emulateMedia({ contrast: 'more' } as never);
      await openScreen(page, byId('workspace.empty'), { size: 'wide', theme });
      await expect(page).toHaveScreenshot(`${name}.png`);
    });

    test(`the Home ribbon with Bold pressed in a contrast theme @forced`, async ({ page }, testInfo) => {
      const name = `forced-ribbon-${theme}`;
      needsBaseline(testInfo, name);
      await start(page, theme);
      await page.emulateMedia({ forcedColors: 'active', colorScheme: theme });
      await openMembranes(page);
      await page.getByRole('textbox', { name: 'Text' }).click();
      await page.keyboard.press('Control+b');
      await settle(page);
      await expect(bar(page)).toHaveScreenshot(`${name}.png`);
    });

    test(`the Draw ribbon with Select and type pressed in a contrast theme @forced`, async ({ page }, testInfo) => {
      const name = `forced-draw-${theme}`;
      needsBaseline(testInfo, name);
      await start(page, theme);
      await page.emulateMedia({ forcedColors: 'active', colorScheme: theme });
      await openMembranes(page);
      await page.getByRole('tab', { name: 'Draw' }).click();
      await page.getByRole('button', { name: 'Select and type' }).click();
      await settle(page);
      await expect(bar(page)).toHaveScreenshot(`${name}.png`);
    });

    test('the compact page screen with the bottom bar', async ({ page }, testInfo) => {
      const name = `compact-bottom-${theme}`;
      needsBaseline(testInfo, name);
      await start(page, theme, 390, 844);
      await page.goto('/');
      await settle(page);
      await expect(page).toHaveScreenshot(`${name}.png`);
    });
  });
}
