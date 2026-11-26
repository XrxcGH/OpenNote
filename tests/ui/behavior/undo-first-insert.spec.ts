// An insert from a tool window into a new, never-typed-in page is its own undo step: Undo takes the insert away
// and leaves the page open with an empty text box, and Redo puts it back (full walk B1-B05-19, A2-A13-1).
import { expect, test } from '../fixtures';
import { runCommand } from '../intel';

test('undo of the first insert into a new page leaves the page open', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await runCommand(page, 'New page');
  const body = page.locator('.ProseMirror').first();
  await expect(body).toBeVisible();
  const heading = page.getByRole('heading', { level: 1 }).first();
  const title = await heading.textContent();
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('opennote:insert-into-page', { detail: { text: 'Answer line', handled: false } }),
    );
  });
  await expect(body).toContainText('Answer line');
  await page.waitForTimeout(600);
  const undo = page.getByRole('button', { name: 'Undo', exact: true }).first();
  await undo.click();
  await expect(page.getByText('Answer line')).toHaveCount(0);
  await expect(heading).toHaveText(title ?? '');
  await expect(page.locator('.ProseMirror').first()).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).first().click();
  await expect(page.locator('.ProseMirror').first()).toContainText('Answer line');
});

test('a layout is its own undo step and leaves the text in place', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await runCommand(page, 'New page');
  const body = page.locator('.ProseMirror').first();
  await body.click();
  await page.keyboard.type('Kept words');
  await page.waitForTimeout(600);
  await runCommand(page, 'Lab notebook');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const undo = page.getByRole('button', { name: 'Undo', exact: true }).first();
  await undo.click();
  await page.waitForTimeout(400);
  await expect(page.getByText('Kept words')).toHaveCount(1);
  await expect(page.locator('.ProseMirror').first()).toBeVisible();
});
