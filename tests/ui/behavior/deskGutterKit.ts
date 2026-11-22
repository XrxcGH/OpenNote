// Shared helpers for the desk gutter behavior specs: opening a page at a size and theme, reading the gutter, zooming,
// and sampling pixels.

import type { Page } from '@playwright/test';
import { expect } from '../fixtures';
import type { Theme } from '../screens';
import { runCommand } from './smart';

export interface Options {
  width?: number;
  height?: number;
  theme?: Theme;
  paper?: boolean;
  mode?: 'Infinite canvas' | 'Document flow' | 'Pages with breaks';
  /** The page to open in Lectures. Membranes has blocks as wide as the viewport, which Fit width cannot go past. */
  name?: string;
}

export async function openPage(page: Page, options: Options = {}): Promise<void> {
  const {
    width = 1440,
    height = 900,
    theme = 'light',
    paper = false,
    mode = 'Document flow',
    name = 'Membranes',
  } = options;
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(
    (appearance) => {
      window.__OPENNOTE_BOOT__ = { settings: { appearance }, bootVersion: 1 } as never;
    },
    { theme, pageColor: paper ? 'paper' : 'match' },
  );
  await page.setViewportSize({ width, height });
  await page.goto('/?fixture=sampler');
  const wide = width >= 1280;
  if (wide) {
    await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
    await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached' });
    if (mode !== 'Infinite canvas') {
      await page.getByRole('tab', { name: 'View' }).click();
      await runCommand(page, 'Document flow');
      if (mode === 'Pages with breaks') await runCommand(page, 'Pages with breaks');
    }
  }
  await page.waitForLoadState('networkidle');
  await quiet(page);
}

/** Waits until the palette is gone and every finite animation has finished, so no sample is taken mid-fade. */
export async function quiet(page: Page): Promise<void> {
  await expect(page.locator('[data-scope="palette"]').getByRole('combobox')).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter(
              (a) =>
                a.playState === 'running' &&
                (a.effect?.getComputedTiming().iterations ?? 1) !== Number.POSITIVE_INFINITY,
            ).length,
      ),
    )
    .toBe(0);
}

export const gutter = (page: Page) =>
  page.evaluate(() => document.querySelector('main')?.getAttribute('data-desk-gutter') ?? null);

/** Waits for the gutter to read the given value (it is written after a measuring frame). */
export async function expectGutter(page: Page, value: number): Promise<void> {
  await expect.poll(() => gutter(page), { timeout: 10_000 }).toBe(String(value));
}

/** The page's zoom in percent, from the title's drawn height against its layout height. */
export const zoomPercent = (page: Page) =>
  page.evaluate(() => {
    const title = document.querySelector<HTMLElement>('[data-page-title]')!;
    return Math.round((title.getBoundingClientRect().height / title.offsetHeight) * 100);
  });

export async function zoomTo(page: Page, percent: number): Promise<void> {
  await page.locator('[contenteditable] p').first().click();
  await page.keyboard.press('Control+Alt+0');
  for (let step = 0; step < 12 && (await zoomPercent(page)) < percent; step++)
    await page.keyboard.press('Control+Alt+Equal');
  await expect.poll(() => zoomPercent(page)).toBeGreaterThanOrEqual(percent);
}

/** The flow column's width in CSS px. */
export const columnWidth = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLElement>('[data-layout]')!.getBoundingClientRect().width);

export const boxes = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('main')!.getBoundingClientRect();
    const paper = document.querySelector('main [data-scope="page"]')!.closest('article')!.getBoundingClientRect();
    return { main: main.toJSON(), paper: paper.toJSON() };
  });

/** The red, green, and blue of a screenshot's pixels on a grid. */
export async function samples(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  const shot = await page.screenshot({ clip });
  return page.evaluate(
    async ({ base64, width, height }) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const out: { x: number; y: number; rgb: [number, number, number] }[] = [];
      for (let y = 0; y < height; y += 4)
        for (let x = 0; x < width; x += 4) {
          const [r, g, b] = context.getImageData(x, y, 1, 1).data;
          out.push({ x, y, rgb: [r!, g!, b!] });
        }
      return out;
    },
    { base64: shot.toString('base64'), width: clip.width, height: clip.height },
  );
}

export const luminance = ([r, g, b]: [number, number, number]) => {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
export const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
