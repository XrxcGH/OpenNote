// The calculator and graphing lane on the page: an equation on a page line shows its solution in gray and Tab adds
// it, Settings turns that off, and an equation shows its answer beside it.

import { expect, test } from '../fixtures';
import { newLine, openSmart } from './smart';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('opennote.math.visual', 'latex');
    } catch {
      // Storage is blocked, and the visual editor stays.
    }
  });
});

test('offers the solution of an equation as it is typed, and Tab adds it as a line', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.type('2x + 3 = 11');
  const ghost = page.locator('[data-note-ghost]');
  await expect(ghost).toContainText('x = 4');
  await page.keyboard.press('Tab');
  await expect(ghost).toHaveCount(0);
  const box = page.getByRole('textbox', { name: 'Text' }).first();
  await expect(box.locator('p').filter({ hasText: /^x = 4$/ })).toHaveCount(1);
  // The added line is a page variable that later lines use.
  await page.keyboard.press('Enter');
  await page.keyboard.type('x * 10 =');
  await expect(page.locator('[data-note-answer]').last()).toHaveText(' 40');
});

test('a switch in Settings, then Editing, turns the solutions off', async ({ page }) => {
  await openSmart(page);
  await page.keyboard.press('Control+Comma');
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await nav.getByRole('link', { name: 'Editing' }).click();
  const solve = page.getByRole('switch', { name: 'Suggest solutions as I write an equation' });
  await expect(solve).toBeChecked();
  await solve.click();
  await expect(solve).not.toBeChecked();
  await page.keyboard.press('Escape');
  await newLine(page);
  await page.keyboard.type('2x + 3 = 11');
  await page.keyboard.type(' ');
  await expect(page.locator('[data-note-ghost]')).toHaveCount(0);
});

test('shows the answer beside an equation', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.press('Alt+=');
  await expect(page.getByRole('textbox', { name: 'Math source' })).toBeFocused();
  await page.keyboard.insertText('2x+3=11');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-math-answer]').last()).toHaveText('x = 4');
});

test('a selected equation offers Graph, which opens a graph beside it that Insert adds below', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.press('Alt+=');
  await expect(page.getByRole('textbox', { name: 'Math source' })).toBeFocused();
  await page.keyboard.insertText('y = x^2');
  await page.keyboard.press('Enter');
  const equation = page.getByRole('math', { name: 'Math: y = x^2' });
  await equation.click();
  const graph = page.getByRole('button', { name: 'Show a graph of this equation' });
  await expect(graph).toBeVisible();
  const blocks = await page.locator('[data-graph]').count();
  await graph.click();
  const popup = page.locator('[data-graph-popup]');
  await expect(popup.getByRole('application', { name: 'Graph of 1 function' })).toBeVisible();
  await popup.getByRole('button', { name: 'Insert graph' }).click();
  await expect(popup).toHaveCount(0);
  await expect(page.locator('[data-graph]')).toHaveCount(blocks + 1);
});

test('an equation in x and y opens a 3D graph from Alt+Shift+G', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.press('Alt+=');
  await expect(page.getByRole('textbox', { name: 'Math source' })).toBeFocused();
  await page.keyboard.insertText('z = x y');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Alt+Shift+G');
  const popup = page.locator('[data-graph-popup]');
  await expect(popup.getByRole('application', { name: '3D graph of 1 function' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
});

test('the equation panel shows the steps of a derivative and solves a system', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.press('Alt+=');
  const field = page.getByRole('textbox', { name: 'Math source' });
  await expect(field).toBeFocused();
  await page.keyboard.insertText('x^3 + 2x');
  await page.getByRole('button', { name: 'Steps' }).click();
  const steps = page.locator('[data-math-steps]');
  await expect(steps).toContainText('Steps for the derivative');
  await expect(steps).toContainText('Power rule');
  await expect(steps.locator('li')).toHaveCount(5);
  await field.fill(String.raw`x + y = 3 \\ x - y = 1`);
  await page.getByRole('button', { name: 'Solve' }).click();
  await expect(field).toHaveValue(/x = 2,\\ y = 1$/);
});
