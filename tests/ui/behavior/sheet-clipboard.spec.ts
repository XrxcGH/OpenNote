// The table clipboard in the production build (ADR 0067): copied cells carry Excel's and Sheets' attributes, a pasted
// Sheets range lands with its formula moved for the cell it lands in, and Paste special transposes. The clipboard
// events are made in the page with their own DataTransfer, so the test never reads or writes the system clipboard.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { openSmart, setCell } from './smart';

const cellAt = (page: Page, row: number, column: number) =>
  page.locator('table tr').nth(row).locator('td, th').nth(column);

/** Selects the cells between two cells of the table by dragging, as a person does. */
async function dragSelect(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await expect(async () => {
    const first = await cellAt(page, from[0], from[1]).boundingBox();
    const last = await cellAt(page, to[0], to[1]).boundingBox();
    if (!first || !last) throw new Error('cells are not shown');
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(cellAt(page, to[0], to[1])).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

/** Fires a copy event at the focused editor and returns what it wrote. */
async function copyNow(page: Page): Promise<{ html: string; text: string }> {
  return page.evaluate(() => {
    const data = new DataTransfer();
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    return { html: data.getData('text/html'), text: data.getData('text/plain') };
  });
}

/** Fires a paste event with this HTML and text at the focused editor. */
async function pasteNow(page: Page, html: string, text: string): Promise<void> {
  await page.evaluate(
    ([h, t]) => {
      const data = new DataTransfer();
      if (h) data.setData('text/html', h);
      data.setData('text/plain', t);
      const target = document.activeElement ?? document.body;
      target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    },
    [html, text],
  );
}

const SHEETS =
  '<google-sheets-html-origin><table data-sheets-root="1"><tbody>' +
  '<tr><td data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:2}">2</td></tr>' +
  '<tr><td data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:3}">3</td></tr>' +
  '<tr><td data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:5}" data-sheets-formula="=R[-2]C[0]+R[-1]C[0]">5</td></tr>' +
  '</tbody></table></google-sheets-html-origin>';

test('copied cells carry values for Excel and Sheets, and tab-separated text', async ({ page }) => {
  await openSmart(page);
  await setCell(page, 1, 0, 'Seed');
  await setCell(page, 1, 1, '12.5');
  await dragSelect(page, [1, 0], [1, 1]);
  const copied = await copyNow(page);
  expect(copied.html).toContain('x:num="12.5"');
  expect(copied.html).toContain('data-opennote-cells');
  expect(copied.text).toBe('Seed\t12.5\r\n');
});

test('a Sheets range pastes with its formula written for the cell it lands in', async ({ page }) => {
  await openSmart(page);
  await dragSelect(page, [1, 0], [1, 0]);
  await pasteNow(page, SHEETS, '2\n3\n5');
  // The header row is grid row 0, so the pasted rows are A1 to A3 and the formula adds A1 and A2.
  await expect(cellAt(page, 1, 0)).toContainText('2');
  await expect(cellAt(page, 2, 0)).toContainText('3');
  await expect(cellAt(page, 3, 0)).toContainText(/5|=A1\+A2/);
});

test('Paste special transposes a copied row into a column', async ({ page }) => {
  await openSmart(page);
  await setCell(page, 1, 0, 'a');
  await setCell(page, 1, 1, 'b');
  await dragSelect(page, [1, 0], [1, 1]);
  await copyNow(page);
  await dragSelect(page, [2, 0], [2, 0]);
  await page.keyboard.press('Control+Alt+v');
  const dialog = page.getByRole('dialog', { name: 'Paste special' });
  await dialog.getByRole('switch', { name: 'Transpose' }).click();
  await dialog.getByRole('button', { name: 'Paste' }).click();
  await expect(cellAt(page, 2, 0)).toHaveText('a');
  await expect(cellAt(page, 3, 0)).toHaveText('b');
});
