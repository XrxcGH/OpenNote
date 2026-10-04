// Resizing in a real browser: the splitters between the notebooks pane, the pages list, and the page (mouse, touch,
// keys, limits, and kept widths); the window going from wide to compact and back; and a page's text boxes. The page
// must re-flow with no overlap, no clipped content, and no sideways scrolling at every size.

import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { VIEWPORTS } from '../screens';

async function openPage(page: Page, fixture = 'sampler') {
  await page.setViewportSize(VIEWPORTS.wide);
  await page.goto(`/?fixture=${fixture}`);
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.locator('[data-block-id]').first()).toBeVisible({ timeout: 20_000 });
}

const splitter = (page: Page, pane: 'notebooks' | 'pages') =>
  page.getByRole('separator', { name: `Resize the ${pane} pane` });

/** Every column of the workspace and the window, in CSS px. */
const columns = (page: Page) =>
  page.evaluate(() => {
    const width = (selector: string) =>
      Math.round(document.querySelector(selector)?.getBoundingClientRect().width ?? 0);
    return {
      notebooks: width('[data-region="notebooks"]'),
      pages: width('[data-region="pages"]'),
      main: width('main'),
      window: window.innerWidth,
    };
  });

async function dragMouse(page: Page, separator: Locator, dx: number) {
  const box = (await separator.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 200;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up();
}

/** What scrolls sideways: the document, and the page's own viewport. */
const sideways = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const viewport = document.querySelector<HTMLElement>('main [class*="viewport"]');
    return {
      document: root.scrollWidth - window.innerWidth,
      page: viewport ? viewport.scrollWidth - viewport.clientWidth : 0,
    };
  });

test.describe('the splitters', () => {
  test('a mouse drag resizes the pane, and the page takes the rest with no overlap', async ({ page }) => {
    await openPage(page);
    await dragMouse(page, splitter(page, 'notebooks'), 60);
    await expect(splitter(page, 'notebooks')).toHaveAttribute('aria-valuenow', '332');
    let now = await columns(page);
    expect(now.notebooks).toBe(332);
    expect(now.notebooks + now.pages + now.main).toBe(now.window);
    await dragMouse(page, splitter(page, 'pages'), -50);
    now = await columns(page);
    expect(now.pages).toBe(250);
    expect(now.notebooks + now.pages + now.main).toBe(now.window);
    expect((await sideways(page)).page).toBeLessThanOrEqual(0);
  });

  test('a touch drag resizes the pane', async ({ page }) => {
    await openPage(page);
    const separator = splitter(page, 'notebooks');
    const box = (await separator.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + 200;
    const touch = (type: string, clientX: number) =>
      separator.dispatchEvent(type, {
        pointerId: 9,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX,
        clientY: y,
        bubbles: true,
      });
    await touch('pointerdown', x);
    await touch('pointermove', x + 30);
    await touch('pointermove', x + 70);
    await touch('pointerup', x + 70);
    await expect(separator).toHaveAttribute('aria-valuenow', '342');
  });

  test('the limits hold: the widest pane leaves the page its minimum, and a long drag past the narrowest collapses it', async ({
    page,
  }) => {
    await openPage(page);
    const separator = splitter(page, 'notebooks');
    const max = Number(await separator.getAttribute('aria-valuemax'));
    await dragMouse(page, separator, 1000);
    await expect(separator).toHaveAttribute('aria-valuenow', String(max));
    expect((await columns(page)).main).toBeGreaterThanOrEqual(480);
    await dragMouse(page, separator, -(max + 100));
    await expect(page.getByRole('button', { name: 'Show notebooks' })).toBeVisible();
    await expect.poll(async () => (await columns(page)).notebooks).toBe(48);
  });

  test('Home and End go to the limits, and Enter collapses and brings back the width', async ({ page }) => {
    await openPage(page);
    const separator = splitter(page, 'pages');
    const [min, max] = await Promise.all([
      separator.getAttribute('aria-valuemin'),
      separator.getAttribute('aria-valuemax'),
    ]);
    await separator.focus();
    await page.keyboard.press('End');
    await expect(separator).toHaveAttribute('aria-valuenow', max!);
    await page.keyboard.press('Home');
    await expect(separator).toHaveAttribute('aria-valuenow', min!);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Show pages' })).toBeVisible();
    await expect(separator).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Show pages' })).toBeHidden();
    await expect(separator).toHaveAttribute('aria-valuenow', min!);
    await expect.poll(async () => (await columns(page)).pages).toBe(Number(min));
  });

  test('the sizes are saved with the device state and come back on the next start', async ({ page }) => {
    await openPage(page);
    await dragMouse(page, splitter(page, 'notebooks'), -20);
    await dragMouse(page, splitter(page, 'pages'), 30);
    const saved = await page.evaluate(() => window.__OPENNOTE_TEST__!.deviceState!());
    expect(saved).toMatchObject({ panes: { notebooks: { width: 252, collapsed: false }, pages: { width: 330 } } });
    const next = await page.context().newPage();
    await next.addInitScript((state) => {
      window.__OPENNOTE_DEV__ = { fixture: 'sample', pseudo: false };
      window.__OPENNOTE_BOOT__ = { state, bootVersion: 1 } as never;
    }, saved);
    await next.setViewportSize(VIEWPORTS.wide);
    await next.goto('/');
    await expect(splitter(next, 'notebooks')).toHaveAttribute('aria-valuenow', '252');
    await expect(splitter(next, 'pages')).toHaveAttribute('aria-valuenow', '330');
    const now = await columns(next);
    expect(now.notebooks + now.pages + now.main).toBe(now.window);
  });
});

test.describe('the window', () => {
  test('goes from wide to compact and back with nothing cut off and no sideways scrolling', async ({ page }) => {
    await openPage(page);
    const sizes = [1440, 1100, 900, 700, 480, 360, 700, 1100, 1440];
    for (const width of sizes) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(400);
      const over = await sideways(page);
      expect(over.document, `document at ${width}`).toBeLessThanOrEqual(0);
      expect(over.page, `page at ${width}`).toBeLessThanOrEqual(0);
      const now = await columns(page);
      expect(now.main, `main at ${width}`).toBeGreaterThan(0);
      expect(now.notebooks + now.pages + now.main, `columns at ${width}`).toBeLessThanOrEqual(now.window);
    }
    const back = await columns(page);
    expect(back.notebooks).toBe(272);
    expect(back.pages).toBe(300);
    await expect(splitter(page, 'notebooks')).toBeVisible();
    await expect(splitter(page, 'pages')).toBeVisible();
  });
});

test.describe('text boxes', () => {
  async function select(page: Page, suffix: string) {
    const box = page.locator(`[data-block-id$="${suffix}"]`);
    await box.locator('[data-scope="editor"]').click({ position: { x: 20, y: 10 } });
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-handle="width"]')).toBeVisible();
    return box;
  }

  async function drag(page: Page, handle: string, dx: number, dy: number) {
    const box = (await page.locator(`[data-handle="${handle}"]`).first().boundingBox())!;
    const x = box.x + Math.min(box.width / 2, 60);
    const y = box.y + Math.min(box.height / 2, 14);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 5 });
    await page.mouse.move(x + dx, y + dy, { steps: 5 });
    await page.mouse.up();
  }

  const frame = (box: Locator) =>
    box.evaluate((element: HTMLElement) => ({
      left: element.offsetLeft,
      top: element.offsetTop,
      width: element.offsetWidth,
      height: element.offsetHeight,
    }));

  test('the width handle changes the width, the text re-flows, and the box stays at least 120 wide', async ({
    page,
  }) => {
    await openPage(page, 'freeform8');
    const box = await select(page, 'q3c1');
    const before = await frame(box);
    await drag(page, 'width', -400, 0);
    const narrow = await frame(box);
    expect(narrow.width).toBe(120);
    expect(narrow.height).toBeGreaterThan(before.height);
    await drag(page, 'width', 150, 0);
    expect((await frame(box)).width).toBe(270);
  });

  test('a box dragged off the page stops at its edge', async ({ page }) => {
    await openPage(page, 'freeform8');
    const box = await select(page, 'q3c1');
    await drag(page, 'grip', -2000, -600);
    const moved = await frame(box);
    expect(moved.left).toBe(0);
    expect(moved.top).toBe(0);
  });

  test('on ruled paper a moved box lands on a rule', async ({ page }) => {
    await openPage(page, 'freeform8');
    await page.getByRole('tab', { name: 'View' }).click();
    await page.getByRole('toolbar').getByRole('button', { name: 'Background' }).click();
    await page.getByRole('menuitemradio', { name: 'Lined, college' }).click();
    const box = await select(page, 'q3c1');
    await drag(page, 'grip', 40, 83);
    await page.waitForTimeout(300);
    const { top } = await frame(box);
    // The college ruling is 26.46 units from a 72 unit top margin.
    const rules = (top - 72) / 26.46;
    expect(Math.abs(rules - Math.round(rules)) * 26.46).toBeLessThan(1);
    expect(top).toBeGreaterThanOrEqual(0);
  });
});
