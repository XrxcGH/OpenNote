// A floating tool window shows its whole frame. The owner asked in November 2026 why the two bottom corners lacked the
// light border that the other edges and the top corners have.
// - The window sits between the command bar's line and the status line, a FLOAT_GAP above the status line.
// - Its bottom corners are rounded like its top ones: nothing inside the window paints over the border's arc there.
// - The arc there has the same color as at the top.

import type { Locator, Page } from '@playwright/test';
import { FLOAT_GAP } from '../../../app/src/features/tools/ui/windowPlacement';
import { expect, test } from '../fixtures';
import { openSmart } from './smart';

/** Runs a command from the palette, found by its placeholder (a tool's own fields are comboboxes too). */
async function palette(page: Page, name: string) {
  // With the caret in the page's text, the status line shows the word count.
  await page.locator('[contenteditable=true] p').first().click();
  const input = page.getByPlaceholder('Type a command or a page name');
  await expect(async () => {
    if (!(await input.isVisible())) await page.keyboard.press('Control+k');
    await expect(input).toBeFocused({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await input.fill(name);
  await page.getByRole('option', { name }).first().click();
}

/** The command bar's bottom edge (its line included) and the status line's top, in CSS px. */
const chrome = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('[data-region="commandBar"]')!.getBoundingClientRect();
    const status = [...document.querySelectorAll('main div')].find(
      (element) => element.children.length < 4 && /^\d+ words?/.test(element.textContent ?? ''),
    );
    return { top: bar.bottom, bottom: status?.getBoundingClientRect().top ?? window.innerHeight };
  });

/** What lies at a window's bottom corners: inside the arc, and in the sliver outside the arc but inside the box. */
const corners = (window: Locator) =>
  window.evaluate((frame) => {
    const box = frame.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(frame).borderEndEndRadius);
    // The resize strip is a plain rectangle over the left border, so it is left out at the bottom-left point.
    const inside = (x: number, y: number) =>
      document
        .elementsFromPoint(x, y)
        .some((element) => frame.contains(element) && element.getAttribute('role') !== 'separator');
    const owns = (x: number, y: number) => {
      const top = document.elementFromPoint(x, y);
      return top !== null && frame.contains(top);
    };
    return {
      radius,
      inArc: [owns(box.left + radius, box.bottom - radius), owns(box.right - radius, box.bottom - radius)],
      outsideArc: [inside(box.left + 1.5, box.bottom - 1.5), inside(box.right - 1.5, box.bottom - 1.5)],
    };
  });

/**
 * The mean color of the border's arc at each corner: top-left, top-right, bottom-left, bottom-right. It averages the
 * screen pixels whose centers lie well inside the 1 px border ring, between 20 and 70 degrees round the corner.
 */
async function arcColors(page: Page, window: Locator) {
  const box = (await window.boundingBox())!;
  const png = (await page.screenshot({ scale: 'css' })).toString('base64');
  return page.evaluate(
    async ({ data, box }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(bitmap, 0, 0);
      const px = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const r = 12;
      const mean = (cx: number, cy: number, sx: number, sy: number) => {
        const sum = [0, 0, 0];
        let n = 0;
        for (let dy = 0; dy <= r; dy += 1)
          for (let dx = 0; dx <= r; dx += 1) {
            const d = Math.hypot(dx + 0.5, dy + 0.5);
            const angle = (Math.atan2(dy + 0.5, dx + 0.5) * 180) / Math.PI;
            if (d < r - 0.85 || d > r - 0.15 || angle < 20 || angle > 70) continue;
            const x = Math.floor(cx + sx * (dx + 0.5));
            const y = Math.floor(cy + sy * (dy + 0.5));
            const i = (y * bitmap.width + x) * 4;
            for (let c = 0; c < 3; c += 1) sum[c] += px[i + c];
            n += 1;
          }
        return sum.map((value) => value / n);
      };
      const { x, y, width, height } = box;
      return [
        mean(x + r, y + r, -1, -1),
        mean(x + width - r, y + r, 1, -1),
        mean(x + r, y + height - r, -1, 1),
        mean(x + width - r, y + height - r, 1, 1),
      ];
    },
    { data: png, box },
  );
}

const distance = (a: number[], b: number[]) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));

/**
 * Waits for a window to be fully built: its tool's code has loaded into the body (an empty body is the loading state,
 * a short box that the loaded tool then grows), and the box has held still for several frames. The arcs are sampled
 * from a screenshot at the box's place, so a box still growing under load would be sampled where the window no longer is.
 */
async function settled(window: Locator) {
  await expect(window.locator(':scope > [data-loading]:not(:empty)'), 'the tool has loaded').toHaveCount(1);
  await window.evaluate(
    (frame) =>
      new Promise<void>((resolve) => {
        const key = () => JSON.stringify(frame.getBoundingClientRect());
        let last = key();
        let still = 0;
        const frameTick = () => {
          const now = key();
          still = now === last ? still + 1 : 0;
          last = now;
          if (still >= 5) resolve();
          else requestAnimationFrame(frameTick);
        };
        requestAnimationFrame(frameTick);
      }),
  );
}

async function checkFrame(page: Page, windows: Locator[], height: number) {
  await expect.poll(async () => (await chrome(page)).bottom, { message: 'the status line shows' }).toBeLessThan(height);
  const edges = await chrome(page);
  for (const window of windows) {
    await expect(window).toBeVisible();
    await settled(window);
    await expect(window, 'the window floats').not.toHaveAttribute('data-docked');
    const box = (await window.boundingBox())!;
    expect(box.y, 'below the command bar and its line').toBeGreaterThanOrEqual(edges.top - 0.5);
    expect(box.y + box.height, 'the bottom edge a gap above the status line').toBeLessThanOrEqual(
      edges.bottom - FLOAT_GAP + 0.5,
    );
    const found = await corners(window);
    expect(found.radius, 'the window is rounded').toBeGreaterThan(4);
    expect(found.inArc, 'inside the bottom corners, the window is on top').toEqual([true, true]);
    expect.soft(found.outsideArc, 'outside the bottom arcs, nothing of the window paints').toEqual([false, false]);
    // Square corners painted the body's color over the arc, 84 to 130 levels off the top's. The body's clip is
    // anti-aliased along the border's inner edge, which darkens the bottom arcs by up to about 33 levels.
    const [topLeft, topRight, bottomLeft, bottomRight] = await arcColors(page, window);
    expect.soft(distance(bottomLeft, topLeft), 'the bottom-left arc matches the top-left').toBeLessThanOrEqual(48);
    expect.soft(distance(bottomRight, topRight), 'the bottom-right arc matches the top-right').toBeLessThanOrEqual(48);
  }
}

for (const height of [600, 800, 1080]) {
  for (const scheme of ['dark', 'light'] as const) {
    test(`the Dynamics and control window shows its whole frame at 1280 by ${height}, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1280, height });
      await openSmart(page);
      await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached' });
      await palette(page, 'Open the dynamics and control tools');
      await checkFrame(page, [page.getByRole('dialog', { name: 'Dynamics and control' })], height);
    });
  }

  test(`two floating windows both show their whole frame at 1024 by ${height}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1024, height });
    await openSmart(page);
    await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached' });
    await palette(page, 'Open calculator');
    await palette(page, 'Open timers');
    await checkFrame(
      page,
      [page.getByRole('dialog', { name: 'Calculator' }), page.getByRole('dialog', { name: 'Timers' })],
      height,
    );
  });
}
