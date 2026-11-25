// An imported column alignment (data.sheet column styles) shows in the real page, with the real stylesheet.
// The cell and the paragraph inside it align as the column says (T4-D11-1).

import { expect, test } from '../fixtures';
import { openSmart } from './smart';

test('an imported column alignment aligns the cell text', async ({ page }) => {
  await openSmart(page, 'alignedTable');
  // The sheet drawing attaches when the table first takes focus.
  await page.locator('table td').first().click();
  await expect(page.locator('[data-sheet]')).toHaveCount(1);
  const align = (row: number, column: number) =>
    page
      .locator('table tr')
      .nth(row)
      .locator('td, th')
      .nth(column)
      .evaluate((el) => ({
        cell: getComputedStyle(el).textAlign,
        para: getComputedStyle(el.querySelector('p') ?? el).textAlign,
      }));
  for (const row of [0, 1]) {
    expect(await align(row, 0)).toEqual({ cell: 'left', para: 'left' });
    expect(await align(row, 1)).toEqual({ cell: 'center', para: 'center' });
    expect(await align(row, 2)).toEqual({ cell: 'right', para: 'right' });
  }
});
