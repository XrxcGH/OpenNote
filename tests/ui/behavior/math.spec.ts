// Math (Phase 10): an equation is drawn with KaTeX and MathML, typed as LaTeX in a field that previews it and
// names a mistake, and added with Alt+= or the slash menu.

import { expect, test } from '../fixtures';
import { newLine, openSmart } from './smart';

test('writes an inline equation with Alt+= and draws it', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.type('Area is ');
  await page.keyboard.press('Alt+=');
  const field = page.getByRole('textbox', { name: 'Math source' });
  await expect(field).toBeFocused();
  await page.keyboard.insertText(String.raw`\frac{\pi r^2}{2`);
  await expect(page.getByRole('status').filter({ hasText: 'LaTeX problem' })).toBeVisible();
  await page.keyboard.insertText('}');
  await expect(page.getByRole('status').filter({ hasText: 'LaTeX problem' })).toHaveCount(0);
  await page.keyboard.press('Enter');
  const equation = page.getByRole('math', { name: String.raw`Math: \frac{\pi r^2}{2}` });
  await expect(equation.locator('.katex')).toBeVisible();
  await expect(equation.locator('math')).toHaveCount(1);
});

test('adds display math from the slash menu', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.type('/equation');
  await expect(page.getByRole('option', { name: 'Insert equation' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Math source' })).toBeFocused();
  await page.keyboard.insertText(String.raw`\int_0^1 x^2\,dx = \frac13`);
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-math-block] .katex-display').last()).toBeVisible();
});

test('keeps the source of a mistake visible and says where it is wrong', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.press('Alt+=');
  await page.keyboard.insertText(String.raw`\notacommand`);
  await page.keyboard.press('Enter');
  const atom = page.locator('[data-math]', { hasText: String.raw`$\notacommand$` });
  await expect(atom).toBeVisible();
  await expect(atom).toHaveAttribute('title', /.+/);
});

test('solves and simplifies from the equation field', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.press('Alt+=');
  const field = page.getByRole('textbox', { name: 'Math source' });
  await expect(field).toBeFocused();
  await page.keyboard.insertText('x^2-4=0');
  await page.getByRole('button', { name: 'Solve' }).click();
  await expect(field).toHaveValue(String.raw`x^2-4=0 \quad\Rightarrow\quad x = -2,\ x = 2`);
  await expect(field).toBeFocused();
  await field.fill(String.raw`\frac{1}{2}+\frac{1}{3}`);
  await page.getByRole('button', { name: 'Simplify' }).click();
  await expect(field).toHaveValue(String.raw`\frac{5}{6}`);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('math', { name: String.raw`Math: \frac{5}{6}` })).toBeVisible();
});

test('says when an action has nothing to do', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.press('Alt+=');
  await expect(page.getByRole('textbox', { name: 'Math source' })).toBeFocused();
  await page.keyboard.insertText('x');
  await page.getByRole('button', { name: 'Simplify' }).click();
  await expect(page.getByRole('textbox', { name: 'Math source' })).toHaveValue('x');
});
