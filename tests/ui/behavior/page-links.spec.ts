// A link to another page (a series' Before and Next) opens that page with Ctrl+click (full walk A1-A08-9).
import { expect, test } from '../fixtures';
import { openPage } from '../ink';

test('Ctrl+click on a page link opens the page', async ({ page }) => {
  await openPage(page);
  const body = page.locator('.ProseMirror').first();
  await body.click();
  await body.evaluate((editor) => {
    const data = new DataTransfer();
    data.setData('text/html', '<a href="opennote:page/p-mitosis">Mitosis</a>');
    data.setData('text/plain', 'Mitosis');
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const link = body.locator('a[href="opennote:page/p-mitosis"]');
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
  await link.click({ modifiers: ['Control'] });
  await expect(page.getByRole('heading', { level: 1, name: 'Mitosis' })).toBeVisible();
});
