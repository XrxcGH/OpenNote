// The layout in a real browser (ARCHITECTURE.md section 11): what each size class shows, geometry that has to hold
// at every size, resizing without a pointer, F6 between regions, and focus staying on a control when the window
// changes size class.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { VIEWPORTS } from '../screens';
import type { SizeClass } from '../screens';

const SIZES = Object.keys(VIEWPORTS) as SizeClass[];

async function open(page: Page, size: SizeClass) {
  await page.setViewportSize(VIEWPORTS[size]);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-size-class', size);
}

const activeRegion = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('[data-region]')?.getAttribute('data-region') ?? 'none');

test.describe('what each size class shows', () => {
  test('wide: both panes, both splitters, and the page', async ({ page }) => {
    await open(page, 'wide');
    await expect(page.getByRole('navigation', { name: 'Notebooks' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible();
    await expect(page.getByRole('separator')).toHaveCount(2);
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('expanded: the notebooks pane, with the pages behind their rail', async ({ page }) => {
    await open(page, 'expanded');
    await expect(page.getByRole('navigation', { name: 'Notebooks' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show pages' })).toBeVisible();
    await expect(page.getByRole('separator')).toHaveCount(1);
  });

  test('medium: the notebooks behind their rail, and the pages pane', async ({ page }) => {
    await open(page, 'medium');
    await expect(page.getByRole('button', { name: 'Show notebooks' })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: 'Lectures' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible();
  });

  test('compact: one screen at a time, with the app bar and no title bar', async ({ page }) => {
    await open(page, 'compact');
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Notebooks' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Pages' })).toHaveCount(0);
    await expect(page.getByRole('banner')).toHaveCount(0);
  });
});

test.describe('geometry', () => {
  for (const size of SIZES) {
    test(`the page never scrolls sideways at ${size}`, async ({ page }) => {
      await open(page, size);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  for (const [density, hit] of [
    ['mouse', 8],
    ['touch', 24],
  ] as const) {
    test(`a splitter hit area is ${hit} px wide with ${density} density`, async ({ page }) => {
      await open(page, 'wide');
      await page.evaluate((value) => (document.documentElement.dataset.density = value), density);
      const box = await page.getByRole('separator', { name: 'Resize the notebooks pane' }).boundingBox();
      expect(box?.width).toBe(hit);
    });
  }

  test('the panes and the page fill the width in the wide layout without overlap', async ({ page }) => {
    await open(page, 'wide');
    const widths = await page.evaluate(() => {
      const width = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().width ?? 0;
      return [width('[data-region="notebooks"]'), width('[data-region="pages"]'), width('main')];
    });
    expect(widths[0]).toBe(272);
    expect(widths[1]).toBe(300);
    expect(widths[0] + widths[1] + widths[2]).toBeCloseTo(VIEWPORTS.wide.width, 0);
    expect(widths[2]).toBeGreaterThanOrEqual(480);
  });
});

// The built app splits its CSS into several files. The layer order (styles/layers.css) has to hold whichever file
// loads first, or base rules beat the component and state rules.
test.describe('cascade layers in the built app', () => {
  test('a keyboard-focused tree row draws its focus ring inside the row', async ({ page }) => {
    await open(page, 'wide');
    await page.getByRole('treeitem', { name: 'Lectures' }).focus();
    await page.keyboard.press('ArrowDown');
    const offset = await page.evaluate(() => {
      const row = document.activeElement;
      return row?.getAttribute('role') === 'treeitem' ? getComputedStyle(row).outlineOffset : 'not a tree row';
    });
    expect(offset).toBe('-2px');
  });

  test('touch density makes the title bar buttons 44 px targets, like the tree rows', async ({ page }) => {
    await open(page, 'wide');
    await page.evaluate(() => (document.documentElement.dataset.density = 'touch'));
    const box = await page.getByRole('button', { name: 'Go back' }).boundingBox();
    expect(box?.height).toBe(44);
  });
});

test.describe('without a pointer', () => {
  test('a splitter resizes with the arrow keys and collapses with Enter', async ({ page }) => {
    await open(page, 'wide');
    const splitter = page.getByRole('separator', { name: 'Resize the notebooks pane' });
    await splitter.focus();
    await page.keyboard.press('ArrowRight');
    await expect(splitter).toHaveAttribute('aria-valuenow', '280');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(splitter).toHaveAttribute('aria-valuenow', '240');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Show notebooks' })).toBeVisible();
    await expect(splitter).toBeFocused();
  });

  test('F6 walks the regions that have controls in order and wraps, never leaving focus on the body', async ({
    page,
  }) => {
    await open(page, 'wide');
    await page.getByRole('treeitem', { name: 'Lectures' }).click();
    await expect(page.getByRole('treeitem', { name: 'Mitosis' })).toBeVisible();
    await page.getByRole('treeitem', { name: 'Labs' }).focus();
    const visited: string[] = [];
    for (let step = 0; step < 5; step += 1) {
      await page.keyboard.press('F6');
      visited.push(await activeRegion(page));
    }
    expect(visited).toEqual(['pages', 'page', 'titleBar', 'commandBar', 'notebooks']);
  });

  test('focus stays on a control as the window moves through every size class', async ({ page }) => {
    await open(page, 'wide');
    await page.getByRole('treeitem', { name: 'Lectures' }).click();
    await page.getByRole('treeitem', { name: 'Mitosis' }).click();
    await page.getByRole('treeitem', { name: 'Labs' }).focus();
    for (const size of ['expanded', 'medium', 'compact', 'wide'] as const) {
      await page.setViewportSize(VIEWPORTS[size]);
      await expect(page.locator('html')).toHaveAttribute('data-size-class', size);
      await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    }
  });
});
