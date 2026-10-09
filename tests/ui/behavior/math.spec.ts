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
  await expect(page.getByRole('textbox', { name: 'Math source' })).toBeFocused();
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

test('shows the equation panel above the lines below it, and Tab reaches its buttons', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.type('Line A');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Line B under it');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.press('Alt+=');
  const field = page.getByRole('textbox', { name: 'Math source' });
  await expect(field).toBeFocused();
  await page.keyboard.insertText('x^2+3x-4=0');
  for (const name of ['Simplify', 'Solve']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    // What a click would land on is the button itself, not the paragraph below the panel.
    const hit = await button.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return top === el || el.contains(top);
    });
    expect(hit).toBe(true);
  }
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Simplify', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Solve', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(field).toHaveValue(/x = /);
});

test('solves the equation just edited from the command palette', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.press('Alt+=');
  await expect(page.getByRole('textbox', { name: 'Math source' })).toBeFocused();
  await page.keyboard.insertText('x^2-4=0');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+K');
  await page.getByRole('combobox', { name: 'Search commands and pages' }).fill('Solve');
  await page
    .getByRole('option')
    .filter({ hasText: /^Solve$/ })
    .click();
  await expect(page.getByRole('textbox', { name: 'Math source' })).toHaveValue(/x = -2,.{1,3}x = 2/);
});

test('typing $x^2$ makes an equation, even typed slowly, and leaves currency alone', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.type('It costs $5 and $10 today. ');
  await expect(page.locator('[data-math]')).toHaveCount(0);
  await page.keyboard.type('Then $x^2$', { delay: 40 });
  await expect(page.getByRole('math', { name: 'Math: x^2' })).toBeVisible();
  await expect(page.getByText('It costs $5 and $10 today.')).toBeVisible();
});

test('typing $$x^2$$ alone on a line makes display math', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.type('$$x^2+1$$');
  await expect(page.locator('[data-math-block]').last()).toBeVisible();
  await expect(page.locator('[data-math-block][data-math-block="x^2+1"]')).toHaveCount(1);
});
