// The screenshot matrix runner: one picture for every screen state, size class, and theme that the packages list in
// tests/ui/screens. It starts empty of baselines. Baselines come only from the update-screenshots workflow, which
// runs this file with --update-snapshots on windows-latest. Until a picture has a baseline, a normal run skips it
// and says so, so the run stays green and a package that adds a screen is not blocked by a missing image.

import { existsSync } from 'node:fs';
import { expect, test } from '../fixtures';
import { describeMatrix, matrixCells, parseFilter, skipWithoutBaseline } from '../matrix';
import { loadScreens, openScreen } from '../screens';

const screens = await loadScreens();
const cells = matrixCells(screens, parseFilter(process.env));

test.describe(`screenshot matrix: ${describeMatrix(cells)}`, () => {
  for (const cell of cells) {
    test(cell.name, async ({ page }, testInfo) => {
      const baseline = testInfo.snapshotPath(`${cell.name}.png`);
      test.skip(
        skipWithoutBaseline(testInfo.config.updateSnapshots, existsSync(baseline)),
        'No baseline yet. Run the update-screenshots workflow to take it.',
      );
      await openScreen(page, cell.screen, { size: cell.size, theme: cell.theme });
      await expect(page).toHaveScreenshot(`${cell.name}.png`);
    });
  }
});
