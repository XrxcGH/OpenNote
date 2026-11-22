// Accessibility of the new text surfaces in the real interface: axe over the Home tab, the Format pane, the font
// picker, and the ruler. Tests tagged @forced also run with forced colors on, where every text run must stay
// readable: no run's color may equal its background (text design 7.6).

import type { Page } from '@playwright/test';
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

/**
 * Runs whose text color equals the color they sit on. The background is the first one that is not transparent,
 * found by walking up from the run, since a run's own background is almost always transparent.
 */
async function clashingRuns(page: Page): Promise<{ checked: number; special: number; clashes: string[] }> {
  return page.evaluate(() => {
    const clashes: string[] = [];
    let checked = 0;
    let special = 0;
    const effectiveBackground = (el: HTMLElement): string => {
      for (let node: HTMLElement | null = el; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    for (const run of document.querySelectorAll<HTMLElement>('[data-scope="editor"][data-block] :is(span, mark)')) {
      if (!run.textContent?.trim()) continue;
      checked += 1;
      if (run.matches('mark, [data-shade], [data-border]') || run.closest('mark, [data-shade], [data-border]'))
        special += 1;
      const color = getComputedStyle(run).color;
      const background = effectiveBackground(run);
      if (color === background) clashes.push(`${run.textContent.slice(0, 30)}: ${color}`);
    }
    return { checked, special, clashes: clashes.slice(0, 5) };
  });
}

test('the formatted note keeps every run readable with forced colors @forced', async ({ page }) => {
  await openNote(page, 'twentyPageFormatted', 'A twenty-page note');
  const { checked, clashes } = await clashingRuns(page);
  expect(checked).toBeGreaterThan(20);
  expect(clashes).toEqual([]);
});

test('highlighted, shaded, and bordered runs stay readable with forced colors @forced', async ({ page }) => {
  await openNote(page, 'highlightedRuns', 'highlighted run');
  const { checked, special, clashes } = await clashingRuns(page);
  // The check must not pass for lack of runs: the highlight and the shading are both there.
  expect(special).toBeGreaterThanOrEqual(2);
  expect(checked).toBeGreaterThanOrEqual(3);
  expect(clashes).toEqual([]);
});
