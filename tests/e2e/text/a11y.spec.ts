// Accessibility of the new text surfaces in the real interface: axe over the Home tab, the Format pane, the font
// picker, and the ruler. Tests tagged @forced also run with forced colors on, where every text run must stay
// readable: no run's color may equal its background (text design 7.6).

import { expect, expectAxeClean, openNote, runCommand, selectParagraph, test } from './helpers';

test.describe('no axe violations @forced', () => {
  test('on the Home tab with text selected', async ({ page }) => {
    const box = await openNote(page);
    await selectParagraph(page, box, 'A few words');
    await expect(page.getByRole('toolbar', { name: 'Home' }).getByRole('combobox', { name: 'Font' })).toBeVisible();
    await expectAxeClean(page, '[role="toolbar"][aria-label="Home"]');
  });

  test('on the font picker with its list open', async ({ page }) => {
    const box = await openNote(page);
    await selectParagraph(page, box, 'A few words');
    const font = page.getByRole('toolbar', { name: 'Home' }).getByRole('combobox', { name: 'Font' });
    await font.focus();
    await font.press('ArrowDown');
    await expect(page.getByRole('listbox').first()).toBeVisible();
    await expectAxeClean(page);
  });

  test('on the Format pane', async ({ page }) => {
    const box = await openNote(page);
    await selectParagraph(page, box, 'A few words');
    await runCommand(page, 'Format pane on Text', /Format pane on Text/);
    await expect(page.getByRole('region', { name: 'Format', exact: true })).toBeVisible();
    await expectAxeClean(page, '[aria-labelledby]:has([role="tablist"][aria-label="Format sections"])');
  });

  test('on the ruler', async ({ page }) => {
    const box = await openNote(page);
    await selectParagraph(page, box, 'A few words');
    await runCommand(page, 'Ruler', /^Ruler/);
    const ruler = page.getByLabel('Ruler', { exact: true }).first();
    await expect(ruler).toBeVisible();
    await expectAxeClean(page, '[aria-label="Ruler"]');
  });
});

test('the formatted note keeps every run readable with forced colors @forced', async ({ page }) => {
  await openNote(page, 'twentyPageFormatted', 'A twenty-page note');
  const clashes = await page.evaluate(() => {
    const found: string[] = [];
    for (const run of document.querySelectorAll<HTMLElement>('[data-scope="editor"][data-block] span')) {
      if (!run.textContent?.trim()) continue;
      const style = getComputedStyle(run);
      if (style.color === style.backgroundColor) found.push(`${run.textContent.slice(0, 30)}: ${style.color}`);
    }
    return found.slice(0, 5);
  });
  expect(clashes).toEqual([]);
});
