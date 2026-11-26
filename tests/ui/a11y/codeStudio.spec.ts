// axe on the Code studio (code:L21): the editor with a problem, the console after a run, and the Problems panel, at
// each size class in both themes. It sits beside screens.spec.ts, not in the screen list, because the list also feeds
// the screenshot matrix, which would need a picture of the studio for each platform.

import { expectNoAxeViolations } from '../axe';
import { expect, test } from '../fixtures';
import { VIEWPORTS } from '../screens';
import type { SizeClass, Theme } from '../screens';
import { boot } from '../audit/walk';
import { newLine, runCommand } from '../behavior/smart';

const SIZES: readonly SizeClass[] = ['compact', 'medium', 'expanded', 'wide'];
const THEMES: readonly Theme[] = ['light', 'dark'];

for (const size of SIZES) {
  for (const theme of THEMES) {
    test(`the Code studio passes axe at ${size} in ${theme}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(VIEWPORTS[size]);
      await page.emulateMedia({ colorScheme: theme });
      await boot(page);
      await newLine(page);
      await runCommand(page, 'New code project');
      const studio = page.getByRole('dialog', { name: 'Code studio' });
      await expect(studio).toBeVisible();
      await page.evaluate(() =>
        (
          window as unknown as { __OPENNOTE_TEST__: { codeStudioFakeRunner(): void } }
        ).__OPENNOTE_TEST__.codeStudioFakeRunner(),
      );
      const editor = studio.getByRole('textbox', { name: 'Code editor, main.py' });
      await editor.click();
      await page.keyboard.press('Control+a');
      await page.keyboard.insertText('a = 1\nraise ValueError("boom")\n');
      await studio.getByRole('button', { name: 'Run', exact: true }).click();
      const log = studio.getByRole('log', { name: 'Console output' });
      await expect(log).toContainText('ValueError: boom');

      // The editor and the console.
      await expectNoAxeViolations(page);
      // The Problems panel.
      await studio.getByRole('tab', { name: /Problems/ }).click();
      await expect(studio.getByRole('tabpanel')).toContainText('boom');
      await expectNoAxeViolations(page);
    });
  }
}
