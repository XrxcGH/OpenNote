// The layout audit (npm run audit:layout): every screen, tool, dialog, menu, and page block of the app at three
// window sizes, in both themes and both densities, checked for clipped text, overlap, covered scroll bars, content
// outside the window, targets too small or too close, and empty space. The findings go to the ratchet
// (ratchet.spec.ts), which compares them with known.json. See README.md.

import { test } from '../fixtures';
import { Auditor } from './auditor';
import { SWEEP_CELLS, activeCells, cellName } from './cells';
import { boot, sweepCommands, walkBlocks, walkSettings, walkSetup, walkTools, walkWorkspace } from './walk';

test.describe.configure({ timeout: 900_000 });
test.use({ actionTimeout: 15_000 });

for (const cell of activeCells()) {
  test(`audit ${cellName(cell)}`, async ({ page }) => {
    page.setDefaultTimeout(20_000);
    await page.setViewportSize({ width: cell.size.width, height: cell.size.height });
    await page.emulateMedia({ colorScheme: cell.theme });
    await page.addInitScript(
      (options) => {
        window.__OPENNOTE_BOOT__ = {
          bootVersion: 1,
          resolvedTheme: options.theme,
          settings: { appearance: { theme: options.theme, density: options.density } },
          ...(sessionStorage.getItem('audit-first-run') === '1'
            ? { firstRun: true, state: { setup: { status: 'notStarted' } } }
            : {}),
        } as never;
      },
      { theme: cell.theme, density: cell.density },
    );
    const audit = new Auditor(page, cell);
    await boot(page, false);
    await walkSetup(audit, page);
    await boot(page, false);
    await walkSettings(audit, page);
    await boot(page, false);
    await walkWorkspace(audit, page);
    await walkTools(audit, page);
    await boot(page);
    await walkBlocks(audit, page);
    if (SWEEP_CELLS.has(cellName(cell))) {
      await boot(page);
      await sweepCommands(audit, page);
    }
    audit.save();
  });
}
