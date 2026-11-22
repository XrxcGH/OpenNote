// The pointer in a table (DESIGN.md section 12): the fill handle continues a series, a row edge changes a row's
// height and a double click fits it, and Draw border and Erase border follow a stroke along the gridlines.

import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { fillSales, openSmart, runCommand } from './smart';

const cell = (page: Page, row: number, column: number): Locator =>
  page.locator('table tr').nth(row).locator('td, th').nth(column);
const inText = (page: Page, row: number, column: number): Locator => cell(page, row, column).locator('p').first();

/** Grid mode on a cell: a click into its text, then Esc, repeated until the cell is selected. */
async function gridAt(page: Page, row: number, column: number): Promise<void> {
  await expect(async () => {
    await inText(page, row, column).click();
    await page.keyboard.press('Escape');
    await expect(cell(page, row, column)).toHaveAttribute('aria-selected', 'true', { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

const center = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test.beforeEach(async ({ page }) => {
  await openSmart(page);
  await expect(cell(page, 0, 0)).toHaveAttribute('aria-rowindex', '1', { timeout: 20_000 });
  await fillSales(page);
});

/** Drags the fill handle to the middle of a cell. */
async function dragFill(page: Page, row: number, column: number): Promise<void> {
  const handle = page.locator('[data-sheet-handle="fill"]');
  await expect(handle).toBeVisible();
  const from = await center(handle);
  const to = await center(cell(page, row, column));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

test('drags the fill handle down and moves the references of a formula', async ({ page }) => {
  await gridAt(page, 2, 2);
  await dragFill(page, 3, 2);
  await expect(cell(page, 3, 2)).toContainText('=B3*0.6');
});

test('continues a series from two numbers, and the menu after the drop copies the cells instead', async ({ page }) => {
  await gridAt(page, 1, 1);
  await page.keyboard.press('Shift+ArrowDown');
  await dragFill(page, 3, 1);
  // 120 and 150 continue as 180.
  await expect(cell(page, 3, 1)).toHaveText('180');
  const menu = page.getByRole('menu', { name: 'Fill options' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitemradio', { name: 'Copy cells' }).click();
  await expect(cell(page, 3, 1)).toHaveText('120');
});

test('fits a row with a double click on its edge, and sets its height by dragging', async ({ page }) => {
  const row = page.locator('table tr').nth(2);
  const before = (await row.boundingBox())!.height;
  const edge = page.locator('[data-row="2"]').first();
  await expect(edge).toBeAttached();
  const at = await center(edge);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await row.boundingBox())!.height).toBeGreaterThan(before + 20);
  await page.locator('[data-row="2"]').first().dblclick();
  await expect.poll(async () => (await row.boundingBox())!.height).toBeLessThan(before + 10);
});

/** A stroke along the bottom edge of the second and third cells of row `row`. */
async function strokeBottom(page: Page, row: number): Promise<void> {
  const second = await cell(page, row, 1).boundingBox();
  const third = await cell(page, row, 2).boundingBox();
  if (!second || !third) throw new Error('no cells');
  const y = second.y + second.height;
  await page.mouse.move(second.x + 40, y);
  await page.mouse.down();
  await page.mouse.move(third.x + third.width - 40, y, { steps: 8 });
  await page.mouse.up();
}

test('draws a border with a stroke, erases it with Erase border, and Escape ends the mode from anywhere', async ({
  page,
}) => {
  await runCommand(page, 'Draw border');
  await expect(page.locator('[data-border-mode="draw"]').first()).toBeAttached();
  await strokeBottom(page, 1);
  await expect(cell(page, 1, 1)).toHaveAttribute('data-bb', 'thin');
  await expect(cell(page, 1, 2)).toHaveAttribute('data-bb', 'thin');
  await runCommand(page, 'Erase border');
  await expect(page.locator('[data-border-mode="erase"]').first()).toBeAttached();
  await strokeBottom(page, 1);
  await expect(cell(page, 1, 1)).not.toHaveAttribute('data-bb', 'thin');
  // The focus is not in a table, as after running the command from the palette.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-border-mode]')).toHaveCount(0);
});

test('Ctrl+Z straight after a drop undoes the fill, and Ctrl+drag copies instead of continuing', async ({ page }) => {
  await gridAt(page, 1, 1);
  await page.keyboard.press('Shift+ArrowDown');
  await dragFill(page, 3, 1);
  await expect(cell(page, 3, 1)).toHaveText('180');
  await page.keyboard.press('Control+z');
  await expect(cell(page, 3, 1)).not.toHaveText('180');
  await expect(page.getByRole('menu', { name: 'Fill options' })).toHaveCount(0);
  await gridAt(page, 1, 1);
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.down('Control');
  await dragFill(page, 3, 1);
  await page.keyboard.up('Control');
  await expect(cell(page, 3, 1)).toHaveText('120');
});

test('the row edges leave the start of the first column text free to click', async ({ page }) => {
  const box = (await inText(page, 2, 0).boundingBox())!;
  const row = (await page.locator('table tr').nth(2).boundingBox())!;
  for (const fraction of [0.25, 0.5, 0.75]) {
    const hit = await page.evaluate(
      ([x, y]) => {
        const element = document.elementFromPoint(x, y);
        return element?.closest('[data-row], [data-sheet-handle]') ? 'edge' : 'cell';
      },
      [box.x + 2, row.y + row.height * fraction],
    );
    expect(hit, `at ${fraction} of the row`).toBe('cell');
  }
  await page.mouse.click(box.x + 2, box.y + box.height / 2);
  // The click reached the cell: the caret is in its text, or the cell is the selected one.
  await expect
    .poll(() =>
      cell(page, 2, 0).evaluate(
        (td) => td.contains(getSelection()?.anchorNode ?? null) || td.getAttribute('aria-selected') === 'true',
      ),
    )
    .toBe(true);
});

test('a long press with a finger opens the menu and lifting the finger does not choose an item', async ({
  page,
  context,
}) => {
  const session = await context.newCDPSession(page);
  const at = await center(cell(page, 2, 1));
  const point = [{ x: at.x, y: at.y, id: 1 }];
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point });
  await page.waitForTimeout(900);
  const menu = page.getByRole('menu').first();
  await expect(menu).toBeVisible();
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  await expect(menu).toBeVisible();
});
