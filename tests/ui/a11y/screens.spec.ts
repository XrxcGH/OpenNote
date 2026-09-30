// axe on every registered screen state, at each size class, in both themes. WP4 grows this into the full
// cross-screen suite with the focus walk, ARIA snapshots, and review.json. It gets the @forced tag, which reruns
// it under forced colors, once WP3's forced-colors tokens land.

import { expectNoAxeViolations } from '../axe';
import { test } from '../fixtures';
import { loadScreens, openScreen } from '../screens';
import type { SizeClass, Theme } from '../screens';

const screens = await loadScreens();
const SIZES: readonly SizeClass[] = ['compact', 'medium', 'expanded', 'wide'];
const THEMES: readonly Theme[] = ['light', 'dark'];

for (const screen of screens) {
  for (const size of screen.sizes ?? SIZES) {
    for (const theme of screen.themes ?? THEMES) {
      test(`${screen.id} passes axe at ${size} in ${theme}`, async ({ page }) => {
        await openScreen(page, screen, { size, theme });
        await expectNoAxeViolations(page);
      });
    }
  }
}
