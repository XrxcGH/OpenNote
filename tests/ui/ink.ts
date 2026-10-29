// Helpers for the ink specs: open a page, pick a Draw tab tool, draw with the mouse, and read what the page shows
// and what the web platform's page service holds.
import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export type Point = readonly [number, number];

export async function openPage(page: Page, name = 'Membranes'): Promise<void> {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.getByRole('tab', { name: 'Draw' }).click();
  await expect(page.locator('[data-ink-overlay]')).toHaveCount(1);
}

/** Chooses a tool or a pen slot on the Draw tab by its accessible name. */
export async function choose(page: Page, name: string): Promise<void> {
  await page.getByRole('toolbar', { name: 'Draw' }).getByRole('button', { name, exact: true }).click();
}

/** Draws a path with the mouse, in pixels from the top left of the page view. */
export async function draw(page: Page, points: readonly Point[]): Promise<void> {
  const box = (await page.locator('[data-ink-overlay]').boundingBox())!;
  const [first, ...rest] = points;
  await page.mouse.move(box.x + first[0], box.y + first[1]);
  await page.mouse.down();
  for (const [x, y] of rest) await page.mouse.move(box.x + x, box.y + y, { steps: 2 });
  await page.mouse.up();
}

export function line(from: Point, to: Point, steps = 16): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => [
    from[0] + ((to[0] - from[0]) * i) / steps,
    from[1] + ((to[1] - from[1]) * i) / steps,
  ]);
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, steps = 32): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
}

/** How many pixels of ink the visible tiles hold. */
export function inkPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    let ink = 0;
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('[data-ink-tiles] canvas')) {
      if (canvas.style.display === 'none') continue;
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) ink++;
    }
    return ink;
  });
}

/** The strokes the web platform's page service holds for the page opened last: ID, tool code, and point count. */
export function heldStrokes(page: Page): Promise<{ id: string; tool: number; palette: number; points: number }[]> {
  return page.evaluate(() => {
    const hooks = (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__;
    const held = hooks.pagesHeld() as {
      memoryInk?: Record<string, { id: string; style: { tool: number; palette: number }; pointCount: number }>;
    };
    return Object.values(held.memoryInk ?? {}).map((s) => ({
      id: s.id,
      tool: s.style.tool,
      palette: s.style.palette,
      points: s.pointCount,
    }));
  });
}

/** Undo with the keyboard, from the page. */
export async function undo(page: Page): Promise<void> {
  await page.keyboard.press('Control+z');
}
