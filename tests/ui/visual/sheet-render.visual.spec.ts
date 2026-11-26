// checks-disable-file brand-consistency: cell colors here are document data of the file format, not interface styling

// Screenshots of drawn cell styles (ADR 0056, DESIGN 9), in light and dark: every border style, every alignment,
// rotation at 45 degrees and stacked, wrap, overflow, clip, banding, and a frozen header scrolled by 200 px. The
// tables are the HTML the render decorations give (harness.ts). Baselines come only from the update-screenshots
// workflow; until a picture has a baseline, a normal run skips it and says so, as the matrix does.

import { existsSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Scheme } from '../../../app/src/features/tables/sheet/render/color';
import {
  MEASURE_SOURCE,
  bordersFixture,
  freezeFixture,
  harnessCss,
  stylesFixture,
  tableHtml,
} from '../../../app/src/features/tables/sheet/render/harness';
import type { Harness } from '../../../app/src/features/tables/sheet/render/harness';
import { expect, test } from '../fixtures';
import { skipWithoutBaseline } from '../matrix';

const SCHEMES: readonly Scheme[] = ['light', 'dark'];

async function show(page: Page, scheme: Scheme, tables: [string, Harness][]): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: 760, height: 900 });
  const body = tables
    .map(([id, h]) =>
      id === 'frozen'
        ? `<div id="frozen-wrap" style="height:220px;width:440px;overflow:auto">${tableHtml(id, h, scheme)}</div>`
        : `<div style="margin-bottom:16px">${tableHtml(id, h, scheme)}</div>`,
    )
    .join('');
  await page.setContent(
    `<!doctype html><html data-theme="${scheme}"><head><style>${harnessCss()}</style></head><body>${body}</body></html>`,
  );
  await page.evaluate(`document.querySelectorAll('table').forEach((t) => (${MEASURE_SOURCE})(t))`);
}

for (const scheme of SCHEMES) {
  test(`cell styles, ${scheme}: border styles and alignments`, async ({ page }, testInfo) => {
    await show(page, scheme, [
      ['borders', bordersFixture()],
      ['styles', stylesFixture()],
    ]);
    const files = [`sheet-borders-${scheme}.png`, `sheet-styles-${scheme}.png`];
    test.skip(
      files.some((f) => skipWithoutBaseline(testInfo.config.updateSnapshots, existsSync(testInfo.snapshotPath(f)))),
      'No baseline yet: the update-screenshots workflow creates it.',
    );
    await expect(page.locator('#borders')).toHaveScreenshot(files[0]);
    await expect(page.locator('#styles')).toHaveScreenshot(files[1]);
  });

  test(`cell styles, ${scheme}: banded look with a frozen header scrolled by 200 px`, async ({ page }, testInfo) => {
    await show(page, scheme, [['frozen', freezeFixture()]]);
    await page.locator('#frozen-wrap').evaluate((el) => {
      el.scrollTop = 200;
    });
    const file = `sheet-frozen-${scheme}.png`;
    test.skip(
      skipWithoutBaseline(testInfo.config.updateSnapshots, existsSync(testInfo.snapshotPath(file))),
      'No baseline yet: the update-screenshots workflow creates it.',
    );
    await expect(page.locator('#frozen-wrap')).toHaveScreenshot(file);
  });
}
