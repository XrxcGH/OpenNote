// Shapes from Shapes > Basic shapes, drawn by the app's own tiles at 8 device pixels to the page unit. The page is zoomed
// to 200 percent in a window of 4 device pixels to the CSS pixel. Each crop sits where shape ink is easiest to get
// wrong: a curved arrow's tip and body, the ends of a double arrow, an arrow's tip, and the corners and sides of the
// closed shapes. Each is compared with its golden. A crop without a golden is skipped until one is taken (npm run
// test:ui:update), as in the gallery. Adding a crop then never blocks a pull request on a missing image.

import { existsSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { skipWithoutBaseline } from '../matrix';
import { openPaper, settledWorld, setZoom, storedStrokes, VIEWPORT } from '../paperSnap';
import type { Vec } from '../paperSnap';

test.use({ viewport: VIEWPORT, deviceScaleFactor: 4 });

/** Each shape's crops: a name and the stored point it centers on, by index into the shape's points. */
const CROPS: { name: string; label: string; at: (points: readonly Vec[]) => Vec[] }[] = [
  // A curved arrow's points are its arc, then barb, tip, barb.
  { name: 'curved-arrow', label: 'Curved arrow', at: (p) => [p.at(-2)!, p[Math.floor((p.length - 3) / 2)]] },
  // A double arrow's: barb, start, barb, start, end, barb, end, barb.
  { name: 'double-arrow', label: 'Double arrow', at: (p) => [p[1], p[4]] },
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

async function addFromLibrary(page: Page, label: string): Promise<Vec[]> {
  await page.getByRole('toolbar', { name: 'Draw' }).getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Basic shapes' }).hover();
  const before = (await page.evaluate(storedStrokes)).length;
  await page.getByRole('menuitem', { name: label, exact: true }).click();
  await expect.poll(async () => (await page.evaluate(storedStrokes)).length).toBeGreaterThan(before);
  return (await page.evaluate(storedStrokes)).slice(before).flatMap((stroke) => stroke.points);
}

for (const { name, label, at } of CROPS) {
  test(`${label.toLowerCase()} at 8x: clean tips, joins, caps, and an even width`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    // Dot paper in page view: its sparse dots leave the ink clear in a crop, and the shape snaps to them the same each
    // run. Each shape gets a fresh page.
    await openPaper(page, 'Dot grid');
    const overlay = (await page.locator('[data-ink-overlay]').boundingBox())!;
    // Zoom about the middle of the sheet, so the middle of the view, where a library shape goes, is on the sheet.
    const world0 = await settledWorld(page);
    await setZoom(page, 2, overlay, { x: world0.x + 408 * world0.zoom, y: overlay.y + overlay.height / 2 });
    const points = await addFromLibrary(page, label);
    // Clear the selection, so its frame and handles leave the crop.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-ink-selection]')).toBeHidden();
    const world = await settledWorld(page);
    const size = CROP_UNITS * world.zoom;
    let shown = 0;
    for (const [k, p] of at(points).entries()) {
      const file = `${name}-${k + 1}.png`;
      if (skipWithoutBaseline(testInfo.config.updateSnapshots, existsSync(testInfo.snapshotPath(file)))) continue;
      const c = { x: world.x + p.x * world.zoom, y: world.y + p.y * world.zoom };
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
