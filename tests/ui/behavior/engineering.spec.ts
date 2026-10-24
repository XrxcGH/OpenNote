// Engineering tools in the app: the free-body diagram, beam, truss, and circuit blocks are added from the slash menu
// and the command palette and solved on the page, and a smart table column takes a unit.
import { expect, test } from '../fixtures';
import { newLine, openSmart, runCommand, setCell } from './smart';

async function slash(page: import('@playwright/test').Page, text: string, option: string): Promise<void> {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.type(text);
  await expect(page.getByRole('option', { name: option })).toBeVisible();
  await page.keyboard.press('Enter');
}

test('adds a free-body diagram from the slash menu and solves the reactions', async ({ page }) => {
  await slash(page, '/free', 'Insert free-body diagram');
  const results = page.getByRole('group', { name: 'Results' });
  await expect(results.getByText('6.25 kN')).toBeVisible();
  await expect(results.getByText(/every sum is zero/)).toBeVisible();
  const force = page.getByRole('button', { name: /^Force F1/ });
  await force.focus();
  await page.keyboard.press('ArrowRight');
  // The force moves half a unit toward the roller, which now takes more of it.
  await expect(results.getByText('4.375 kN')).toBeVisible();
});

test('adds a beam from the palette and draws its shear and moment diagrams', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await runCommand(page, 'Insert beam solver');
  await expect(page.getByRole('img', { name: /^Shear force V diagram/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /^Bending moment M diagram/ })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Results' }).getByText('9.667 kN')).toBeVisible();
});

test('adds a truss and a circuit and shows their answers', async ({ page }) => {
  await slash(page, '/truss', 'Insert truss solver');
  await expect(page.getByText(/Statically determinate: 7 members/)).toBeVisible();
  await newLine(page);
  await page.keyboard.type('/circuit');
  await expect(page.getByRole('option', { name: 'Insert circuit' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Solved by nodal analysis.')).toBeVisible();
  await expect(page.getByText('V1 delivers 12 mW')).toBeVisible();
});

test('gives a table column a unit and converts what is typed in it', async ({ page }) => {
  await openSmart(page);
  await setCell(page, 2, 1, '250 N');
  await setCell(page, 1, 1, '2');
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('menuitem', { name: 'Number format' }).click();
  await page.getByRole('menuitem', { name: 'Unit…' }).click();
  const field = page.getByRole('textbox', { name: 'Unit' });
  await field.fill('kN');
  await page.getByRole('button', { name: 'Set unit' }).click();
  // The cell being edited shows what was typed, so look at the one below it.
  await expect(page.locator('table tr').nth(2).locator('td, th').nth(1)).toHaveAttribute('data-shown', '0.25 kN');
});
