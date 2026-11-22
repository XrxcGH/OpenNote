// Screenshots of the desk gutter (docs/BRAND.md amendments A11 to A13): the strips and motifs at Wide in light and dark,
// the 19 px gutter at 125 percent with no motifs, Expanded with no gutter, Paper in dark with no gutter, forced colors,
// and more contrast. Baselines come only from the update-screenshots workflow. Until a picture has a baseline, a normal
// run skips it and says so, as the matrix does.

import { existsSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { skipWithoutBaseline } from '../matrix';
import { settle } from '../screens';
import type { Theme } from '../screens';

interface State {
  name: string;
  width: number;
  height: number;
  themes: readonly Theme[];
  paper?: boolean;
  forced?: boolean;
  contrast?: boolean;
  zoom?: number;
}

const BOTH: readonly Theme[] = ['light', 'dark'];

const STATES: readonly State[] = [
  { name: 'wide', width: 1440, height: 900, themes: BOTH },
  { name: 'wide-125', width: 1440, height: 900, themes: BOTH, zoom: 125 },
  { name: 'expanded', width: 1024, height: 768, themes: BOTH },
  { name: 'paper-in-dark', width: 1440, height: 900, themes: ['dark'], paper: true },
  { name: 'forced', width: 1440, height: 900, themes: BOTH, forced: true },
  { name: 'more-contrast', width: 1440, height: 900, themes: BOTH, contrast: true },
];

async function open(page: Page, state: State, theme: Theme): Promise<void> {
  await page.emulateMedia({
    colorScheme: theme,
    ...(state.forced ? { forcedColors: 'active' as const } : {}),
    ...(state.contrast ? { contrast: 'more' as const } : {}),
  });
  await page.addInitScript(
    (appearance) => {
      window.__OPENNOTE_BOOT__ = { settings: { appearance }, bootVersion: 1 } as never;
    },
    { theme, pageColor: state.paper ? 'paper' : 'match' },
  );
  await page.setViewportSize({ width: state.width, height: state.height });
  await page.goto('/?fixture=sampler');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Mitosis' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mitosis' })).toBeVisible();
  await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached' });
  if (state.zoom) {
    await page.locator('[contenteditable] p').first().click();
    await page.keyboard.press('Control+Alt+0');
    for (let step = 0; step < 6; step++) await page.keyboard.press('Control+Alt+Equal');
  }
  await settle(page);
}

for (const state of STATES) {
  for (const theme of state.themes) {
    test(`desk gutter ${state.name} in ${theme}${state.forced ? ' @forced' : ''}`, async ({ page }, testInfo) => {
      const file = `${state.name}-${theme}.png`;
      test.skip(
        skipWithoutBaseline(testInfo.config.updateSnapshots, existsSync(testInfo.snapshotPath(file))),
        'No baseline yet. Run the update-screenshots workflow to take it.',
      );
      await open(page, state, theme);
      await expect(page.locator('main')).toHaveScreenshot(file);
    });
  }
}
