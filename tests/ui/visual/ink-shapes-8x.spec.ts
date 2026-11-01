// Shapes from Shapes > Basic shapes, drawn by the app's own tiles at 8 device pixels to the page unit. The page is zoomed
// to 200 percent in a window of 4 device pixels to the CSS pixel. Each crop sits where shape ink is easiest to get
// wrong: a curved arrow's tip and body, the ends of a double arrow, an arrow's tip, and the corners and sides of the
// closed shapes. The heads of curved and double arrows are cropped in the dark theme too, where the ink is light on a
// dark sheet. Each is compared with its golden. A crop without a golden is skipped until one is taken (npm run
// test:ui:update), as in the gallery. Adding a crop then never blocks a pull request on a missing image.

import { existsSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { skipWithoutBaseline } from '../matrix';
import { openPaper, settledWorld, storedStrokes, VIEWPORT } from '../paperSnap';
import type { Vec } from '../paperSnap';

test.use({ viewport: VIEWPORT, deviceScaleFactor: 4 });

/** Each shape's crops: a name, the stored point it centers on by index into the shape's points, and the themes. */
const CROPS: { name: string; label: string; at: (points: readonly Vec[]) => Vec[]; dark?: boolean }[] = [
  // A curved arrow's points are its arc, then barb, tip, barb.
  {
    name: 'curved-arrow',
    label: 'Curved arrow',
    at: (p) => [p.at(-2)!, p[Math.floor((p.length - 3) / 2)]],
    dark: true,
  },
  // A double arrow's: barb, start, barb, start, end, barb, end, barb.
  { name: 'double-arrow', label: 'Double arrow', at: (p) => [p[1], p[4]], dark: true },
  { name: 'arrow', label: 'Arrow', at: (p) => [p[1]] },
  { name: 'rectangle', label: 'Rectangle', at: (p) => [p[1], mid(p[1], p[2])] },
  { name: 'triangle', label: 'Triangle', at: (p) => [p[0], p[2]] },
  { name: 'star', label: 'Star', at: (p) => [p[0], p[1]] },
  { name: 'hexagon', label: 'Hexagon', at: (p) => [p[0]] },
  { name: 'circle', label: 'Circle', at: (p) => [p[0]] },
];

const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
/** Each crop is this many page units square: 192 device pixels at 8 to the unit. */
const CROP_UNITS = 24;

/**
 * Zooms the page to exactly 200 percent with the View tab's zoom steps, about the middle of the view. A Ctrl+wheel zoom
 * lands only near the target, and a crop then sits a fraction of a device pixel off its golden, which shifts the
 * antialiasing of every edge.
 */
async function zoomToTwice(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'View' }).click();
  // The zoom commands sit under More commands at this width.
  const run = async (name: string) => {
    await page
      .getByRole('toolbar', { name: 'View' })
      .getByRole('button', { name: 'More commands', exact: true })
      .click();
    await page.getByRole('menu', { name: 'More commands' }).getByRole('menuitem', { name, exact: true }).click();
  };
  await run('Actual page size');
  // 100, 110, 125, 150, 175, then 200 percent.
  for (let i = 0; i < 5; i += 1) await run('Zoom page in');
  await expect.poll(async () => (await settledWorld(page)).zoom).toBe(2);
  await page.getByRole('tab', { name: 'Draw' }).click();
}

async function addFromLibrary(page: Page, label: string): Promise<Vec[]> {
  await page.getByRole('toolbar', { name: 'Draw' }).getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Basic shapes' }).hover();
  const before = (await page.evaluate(storedStrokes)).length;
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await expect.poll(async () => (await page.evaluate(storedStrokes)).length).toBeGreaterThan(before);
  return (await page.evaluate(storedStrokes)).slice(before).flatMap((stroke) => stroke.points);
}

const RUNS = CROPS.flatMap((crop) => [
  { ...crop, theme: 'light' as const },
  ...(crop.dark ? [{ ...crop, theme: 'dark' as const }] : []),
]);

for (const { name, label, at, theme } of RUNS) {
  const suffix = theme === 'dark' ? ', dark theme' : '';
  test(`${label.toLowerCase()} at 8x${suffix}: clean tips, joins, caps, and an even width`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: theme });
    // Dot paper in page view: its sparse dots leave the ink clear in a crop, and the shape snaps to them the same each
    // run. Each shape gets a fresh page.
    await openPaper(page, 'Dot grid');
    await zoomToTwice(page);
    const points = await addFromLibrary(page, label);
    // Clear the selection, so its frame and handles leave the crop.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-ink-selection]')).toBeHidden();
    const world = await settledWorld(page);
    const size = CROP_UNITS * world.zoom;
    let shown = 0;
    for (const [k, p] of at(points).entries()) {
      const file = theme === 'dark' ? `${name}-dark-${k + 1}.png` : `${name}-${k + 1}.png`;
      if (skipWithoutBaseline(testInfo.config.updateSnapshots, existsSync(testInfo.snapshotPath(file)))) continue;
      const c = { x: world.x + p.x * world.zoom, y: world.y + p.y * world.zoom };
      console.log(`[8x] ${file} try ${testInfo.retry} world ${JSON.stringify(world)} c ${JSON.stringify(c)}`);
      console.log(`[8x] ${file} points ${JSON.stringify(points)}`);
      await expect(page).toHaveScreenshot(file, {
        clip: { x: c.x - size / 2, y: c.y - size / 2, width: size, height: size },
        // At the window's 4 device pixels to the CSS pixel, not a CSS-pixel picture scaled up.
        scale: 'device',
        // Antialiased ink differs by a shade at a few edge pixels between GPUs; a misplaced join moves dozens.
        maxDiffPixelRatio: 0.01,
        threshold: 0.2,
      });
      shown += 1;
    }
    test.skip(shown === 0, 'No goldens yet. Run npm run test:ui:update to take them.');
  });
}
