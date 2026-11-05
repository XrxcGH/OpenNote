// Screenshots of the calm polish (docs/BRAND.md sections 4, 8, and 12). They show the command bar's icons and pressed
// states, the Draw bar with its pens, the More menu, the notebook's color on the title rule, the plum evening, a flat
// canvas for more contrast, and the forced-colors states. Baselines come only from the update-screenshots workflow.
// Until a picture has a baseline, a normal run skips it and says so, as the matrix does.

import { existsSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
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

const bar = (page: Page): Locator => page.locator('[data-region="commandBar"]').first();

async function pressBold(page: Page): Promise<void> {
  await page.getByRole('textbox', { name: 'Text' }).click();
  await page.keyboard.press('Control+b');
  await settle(page);
}

async function forced(page: Page, theme: Theme): Promise<void> {
  await start(page, theme);
  await page.emulateMedia({ forcedColors: 'active', colorScheme: theme });
  await openMembranes(page);
}

/** One picture: how the page gets there, and what is photographed. */
interface Shot {
  name: string;
  tags?: string;
  run(page: Page, theme: Theme): Promise<Locator | Page>;
  clip?: { x: number; y: number; width: number; height: number };
}

const ribbon = (size: string, width: number): Shot => ({
  name: `home-ribbon-${size}`,
  async run(page, theme) {
    await start(page, theme, width, 900);
    await openMembranes(page);
    await pressBold(page);
    return bar(page);
  },
});

const drawBar = (label: string, width: number, height: number): Shot => ({
  name: `draw-ribbon-${label}`,
  async run(page, theme) {
    await start(page, theme, width, height);
    await openMembranes(page);
    await page.getByRole('tab', { name: 'Draw' }).click();
    await settle(page);
    return bar(page);
  },
});

const SHOTS: readonly Shot[] = [
  ribbon('wide', 1440),
  ribbon('expanded', 1024),
  ribbon('medium', 720),
  drawBar('with-pens', 1280, 800),
  drawBar('pens-in-more', 1024, 768),
  {
    name: 'view-ribbon',
    async run(page, theme) {
      await start(page, theme);
      await openMembranes(page);
      await page.getByRole('tab', { name: 'View' }).click();
      await settle(page);
      return bar(page);
    },
  },
  {
    name: 'more-menu-medium',
    async run(page, theme) {
      await start(page, theme, 720, 900);
      await openMembranes(page);
      await bar(page).getByRole('button', { name: 'More commands' }).click();
      await page.getByRole('menu').waitFor();
      await settle(page);
      return page;
    },
  },
  {
    name: 'title-rule',
    async run(page, theme) {
      await start(page, theme);
      await openMembranes(page);
      return page.getByRole('heading', { level: 1, name: 'Membranes' });
    },
  },
  {
    name: 'empty-horizon',
    clip: { x: 0, y: 600, width: 1440, height: 300 },
    async run(page, theme) {
      await openScreen(page, byId('workspace.empty'), { size: 'wide', theme });
      return page;
    },
  },
  {
    name: 'setup-welcome',
    async run(page, theme) {
      await openScreen(page, byId('setup.welcome'), { size: 'wide', theme });
      return page;
    },
  },
  {
    name: 'more-contrast',
    async run(page, theme) {
      await page.emulateMedia({ contrast: 'more' } as never);
      await openScreen(page, byId('workspace.empty'), { size: 'wide', theme });
      return page;
    },
  },
  {
    name: 'forced-ribbon',
    tags: '@forced',
    async run(page, theme) {
      await forced(page, theme);
      await pressBold(page);
      return bar(page);
    },
  },
  {
    name: 'forced-draw',
    tags: '@forced',
    async run(page, theme) {
      await forced(page, theme);
      await page.getByRole('tab', { name: 'Draw' }).click();
      await page.getByRole('button', { name: 'Select and type' }).click();
      await settle(page);
      return bar(page);
    },
  },
  {
    name: 'compact-bottom',
    async run(page, theme) {
      await start(page, theme, 390, 844);
      await page.goto('/');
      await settle(page);
      return page;
    },
  },
];

for (const theme of THEMES) {
  for (const shot of SHOTS) {
    test(`polish ${shot.name} in ${theme} ${shot.tags ?? ''}`.trim(), async ({ page }, testInfo) => {
      const file = `${shot.name}-${theme}.png`;
      test.skip(
        skipWithoutBaseline(testInfo.config.updateSnapshots, existsSync(testInfo.snapshotPath(file))),
        'No baseline yet. Run the update-screenshots workflow to take it.',
      );
      const target = await shot.run(page, theme);
      if ('goto' in target) await expect(target).toHaveScreenshot(file, shot.clip ? { clip: shot.clip } : {});
      else await expect(target).toHaveScreenshot(file);
    });
  }
}
