// Insert video, podcast, or embed from link always answers: a link to another site goes in as a normal link, as
// the dialog promises, and text that is not a link says so (full walk B-B02-8).
import { expect, test } from '../fixtures';
import { runCommand } from '../intel';
import { openPage } from '../ink';

async function insertFromLink(page: import('@playwright/test').Page, text: string): Promise<void> {
  await runCommand(page, 'embed from link');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill(text);
  await dialog.getByRole('button', { name: 'Insert' }).click();
  await expect(dialog).toHaveCount(0);
}

test('a link to another site goes in as a normal link, and plain text says why', async ({ page }) => {
  await openPage(page);
  await page.locator('.ProseMirror').first().click();
  await insertFromLink(page, 'https://example.com/page');
  await expect(page.locator('.ProseMirror a[href="https://example.com/page"]')).toHaveCount(1);
  await insertFromLink(page, 'hello');
  await expect(page.getByText(/a web address/i)).not.toHaveCount(0, { timeout: 15_000 });
});
