// Apply and change styles, with the Format pane and the ruler: the pane's Paragraph tab sets an alignment, the
// ruler shows for the focused text, and a style change reaches the page.

import { expect, openNote, runCommand, selectParagraph, test } from './helpers';

test('the Format pane changes the paragraph it was opened on', async ({ page }) => {
  const box = await openNote(page);
  const paragraph = await selectParagraph(page, box, 'A few words');
  await runCommand(page, 'Format pane on Paragraph', /Format pane on Paragraph/);
  const pane = page.getByRole('region', { name: 'Format', exact: true });
  await expect(pane).toBeVisible();
  await expect(pane.getByRole('tablist', { name: 'Format sections' })).toBeVisible();
  await pane.getByRole('combobox', { name: 'Alignment' }).selectOption({ label: 'Center' });
  await expect(paragraph).toHaveCSS('text-align', 'center');
  await pane.getByRole('button', { name: 'Close' }).click();
  await expect(pane).toHaveCount(0);
  await expect(paragraph).toBeVisible();
});

test('the ruler shows over the focused text', async ({ page }) => {
  const box = await openNote(page);
  await selectParagraph(page, box, 'A few words');
  await runCommand(page, 'Ruler', /^Ruler/);
  await expect(page.getByLabel('Ruler', { exact: true }).first()).toBeVisible();
});
