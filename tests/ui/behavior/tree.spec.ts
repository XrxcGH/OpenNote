// The navigation tree in the production build, with real keys and a real mouse: walking the tree with the keyboard,
// renaming with an error, deleting with Undo, and dragging a row. Focus is checked after each action.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Labs' }).waitFor();
});

const notebooks = (page: Page) => page.getByRole('tree', { name: 'Notebooks' });
const pages = (page: Page) => page.getByRole('tree', { name: 'Pages' });

test('walks the tree with the keyboard and opens a page with Enter', async ({ page }) => {
  await notebooks(page).getByRole('treeitem', { name: 'Lectures' }).focus();
  await page.keyboard.press('Enter');
  await expect(pages(page).getByRole('treeitem', { name: 'Cell structure' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(pages(page).getByRole('treeitem', { name: 'Mitosis' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Mitosis' })).toBeFocused();
});

test('keeps a refused name in the field, says why, and commits a good one', async ({ page }) => {
  const labs = notebooks(page).getByRole('treeitem', { name: 'Labs' });
  await labs.focus();
  await page.keyboard.press('F2');
  const field = page.getByRole('textbox', { name: 'Rename Labs' });
  await expect(field).toBeFocused();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription("A name can't be empty.");
  await expect(field).toBeFocused();
  await page.keyboard.type('Practicals');
  await page.keyboard.press('Enter');
  await expect(notebooks(page).getByRole('treeitem', { name: 'Practicals' })).toBeFocused();
});

test('deletes a page, focuses its neighbor, and brings it back with Ctrl+Z', async ({ page }) => {
  await notebooks(page).getByRole('treeitem', { name: 'Lectures' }).click();
  const mitosis = pages(page).getByRole('treeitem', { name: 'Mitosis' });
  await mitosis.focus();
  await page.keyboard.press('Delete');
  await expect(pages(page).getByRole('treeitem', { name: 'Meiosis' })).toBeFocused();
  const toast = page.getByRole('status', { name: 'Notifications' });
  await expect(toast).toContainText('Moved "Mitosis" to Trash.');
  await toast.getByRole('button', { name: 'Close' }).click();
  await page.keyboard.press('Control+Z');
  await expect(mitosis).toBeVisible();
  await expect(mitosis).toBeFocused();
});

test('moves a section by dragging it with the mouse', async ({ page }) => {
  const labs = await notebooks(page).getByRole('treeitem', { name: 'Labs' }).boundingBox();
  const exam = await notebooks(page).getByRole('treeitem', { name: 'Exam prep' }).boundingBox();
  if (!labs || !exam) throw new Error('The rows have no place on screen.');
  await page.mouse.move(labs.x + 40, labs.y + labs.height / 2);
  await page.mouse.down();
  await page.mouse.move(labs.x + 40, labs.y + labs.height / 2 + 10, { steps: 3 });
  await page.mouse.move(exam.x + 40, exam.y + exam.height * 0.95, { steps: 6 });
  await expect(notebooks(page).locator('[data-drop="after"]')).toHaveCount(1);
  await page.mouse.up();
  const titles = notebooks(page).getByRole('treeitem');
  await expect(titles.nth(1)).toHaveAccessibleName('Lectures');
  await expect(titles.nth(2)).toHaveAccessibleName('Exam prep');
  await expect(titles.nth(3)).toHaveAccessibleName('Labs');
});

test('moves a row with Ctrl+Shift+Down and keeps focus on it', async ({ page }) => {
  const labs = notebooks(page).getByRole('treeitem', { name: 'Labs' });
  await labs.focus();
  await page.keyboard.press('Control+Shift+ArrowDown');
  await expect(labs).toBeFocused();
  await expect(notebooks(page).getByRole('treeitem').nth(3)).toHaveAccessibleName('Labs');
});
