// PDF pages to write on (A4-10) and note space (A2-20), on the web platform. pdf.js reads a small PDF made by the test,
// so this checks the whole path from the file chooser to locked page pictures.

import { expect, test } from '../fixtures';
import { openMembranes, runCommand } from '../intel';
import { insertPdf } from '../pdf';

test('Insert PDF puts each page on the page as a picture locked in place', async ({ page }) => {
  await openMembranes(page);
  await insertPdf(page, 'lecture.pdf', ['Cell walls', 'Osmosis']);
  await expect(page.getByRole('group', { name: /Page 2 of 2 from lecture\.pdf/ })).toBeVisible();
  await expect(page.getByText('Added 2 pages of lecture.pdf to this page.')).toBeVisible();
});

test('Add note space puts ruled paper beside a PDF page', async ({ page }) => {
  await openMembranes(page);
  await insertPdf(page, 'notes.pdf', ['Mitosis']);
  await runCommand(page, 'Add note space');
  const dialog = page.getByRole('dialog', { name: 'Add note space' });
  await dialog.getByRole('radio', { name: 'On the right and below' }).click();
  await dialog.getByRole('button', { name: 'Add note space' }).click();
  await expect(page.getByText('Added note space to 1 page.')).toBeVisible();
  await expect(page.getByRole('group', { name: /Ruled note space|Decorative image/ })).toHaveCount(2);
});

test('a damaged PDF is refused calmly and adds nothing', async ({ page }) => {
  await openMembranes(page);
  const chooser = page.waitForEvent('filechooser');
  await runCommand(page, 'Insert PDF');
  await (await chooser).setFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  await expect(page.getByText('broken.pdf could not be read. It may be damaged or not a PDF.')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('group', { name: /from broken\.pdf/ })).toHaveCount(0);
});

test('Make handouts lays out PDF pages 2 to a page as new pages at the end of the section', async ({ page }) => {
  await openMembranes(page);
  await insertPdf(page, 'slides.pdf', ['Enzymes', 'Substrates', 'Inhibitors']);
  await runCommand(page, 'Make handouts');
  const dialog = page.getByRole('dialog', { name: 'Make handouts' });
  await dialog.getByRole('radio', { name: /^2 / }).click();
  await dialog.getByRole('radio', { name: 'Blank' }).click();
  await dialog.getByRole('button', { name: 'Make handouts' }).click();
  await expect(page.getByText('Made 2 handout pages.')).toBeVisible({ timeout: 30_000 });
  const pages = page.getByRole('tree', { name: 'Pages' });
  await expect(pages.getByRole('treeitem', { name: 'Handout 1' })).toBeVisible();
  await expect(pages.getByRole('treeitem', { name: 'Handout 2' })).toBeVisible();
  await pages.getByRole('treeitem', { name: 'Handout 1' }).click();
  await expect(page.getByRole('group', { name: /from slides\.pdf|Handout/ }).first()).toBeVisible();
});
