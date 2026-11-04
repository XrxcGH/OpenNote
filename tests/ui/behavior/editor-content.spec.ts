// Editor content, from the Beta 8 full walk (group 47 to 53): spreadsheet text pastes as a table, a copy gives plain
// text, a bad custom color says why, a callout's buttons answer the keyboard, a last equation keeps a line below it,
// and a table cell's menu has the row and column commands.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

/** The blocks the page service holds: their types and Markdown. */
function held(page: Page): Promise<{ type: string; data: Record<string, unknown> }[]> {
  return page.evaluate(() => {
    const hooks = (
      window as unknown as {
        __OPENNOTE_TEST__: { pagesHeld(): { blocks: { type: string; data: Record<string, unknown> }[] } };
      }
    ).__OPENNOTE_TEST__;
    return hooks.pagesHeld().blocks.map((block) => ({ type: block.type, data: block.data }));
  });
}

/** Pastes clipboard data the way Ctrl+V delivers it. */
async function paste(page: Page, data: Record<string, string>): Promise<void> {
  await page.evaluate((data) => {
    const transfer = new DataTransfer();
    for (const [type, value] of Object.entries(data)) transfer.setData(type, value);
    document.activeElement!.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, data);
}

async function openPage(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await page.getByRole('textbox', { name: 'Text' }).click();
  await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached' });
}

test('pastes spreadsheet text as a table, and a copy gives plain text', async ({ page }) => {
  await openPage(page);
  await paste(page, { 'text/plain': 'Item\tQty\nPens\t12\nPaper\t3' });
  await expect.poll(async () => (await held(page)).map((block) => block.type)).toContain('table');
  const table = (await held(page)).find((block) => block.type === 'table')!;
  expect((table.data.rows as unknown[]).length).toBe(3);

  // A copy of bold words puts the words, not the Markdown marks, on the clipboard as text.
  await page.getByRole('textbox', { name: 'Text' }).first().click();
  await page.keyboard.type('Alpha **bold part** omega');
  const flavors = await page.evaluate(() => {
    // The text box with the caret, not the table's editor, which comes first in the page.
    const editor = document.activeElement as HTMLElement;
    getSelection()!.selectAllChildren(editor);
    const transfer = new DataTransfer();
    editor.dispatchEvent(new ClipboardEvent('copy', { clipboardData: transfer, bubbles: true, cancelable: true }));
    return { text: transfer.getData('text/plain'), html: transfer.getData('text/html') };
  });
  expect(flavors.text).toBe('Alpha bold part omega');
  expect(flavors.html).toContain('<strong>');
});

test('a table cell has its own menu with the row and column commands', async ({ page }) => {
  await openPage(page);
  await paste(page, { 'text/plain': 'a\tb\nc\td' });
  const cell = page.getByRole('group', { name: /^Table(:|$)/ }).getByRole('cell').first();
  await cell.click();
  await cell.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Add row above' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Add column left' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete table' })).toBeVisible();
});

test('a callout is reached from its title with Tab, and Escape returns to the text', async ({ page }) => {
  await openPage(page);
  await page.keyboard.type('> [!tip]- Plan ');
  const type = page.getByRole('button', { name: /^Callout type: / });
  await expect(type).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(type).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^(Fold|Collapse|Expand)/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Text' }).first()).toBeFocused();
});

test('keeps an empty line below a last equation', async ({ page }) => {
  await openPage(page);
  await page.keyboard.type('$$x^2$$');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.querySelector('.ProseMirror[contenteditable="true"]')!;
        return root.lastElementChild?.tagName;
      }),
    )
    .toBe('P');
});
