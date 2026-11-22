// The desk gutter's motifs, ceiling, and stillness (docs/BRAND.md amendments A11 to A13). The vine and stars stay clear
// of the paper, the edges, and every text box. The strips stay within 1.5:1 of the sunken canvas. Nothing in the
// strips animates, also after the pages pane is collapsed and restored.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { runCommand } from './smart';
import { boxes, expectGutter, openPage, quiet, ratio, samples, zoomTo } from './deskGutterKit';

test.describe('the motifs', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`stay clear of the paper, the edges and all text in ${theme}`, async ({ page }) => {
      await openPage(page, { theme });
      await expectGutter(page, 24);
      const result = await page.evaluate(() => {
        const main = document.querySelector('main')!.getBoundingClientRect();
        const paper = document.querySelector('main article')!.getBoundingClientRect();
        const out: Record<string, { display: string; left: number; right: number; top: number; bottom: number }> = {};
        for (const name of ['gutter-vine', 'gutter-stars']) {
          const element = document.querySelector(`[data-art="${name}"]`)!;
          const r = element.getBoundingClientRect();
          out[name] = {
            display: getComputedStyle(element).display,
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
          };
        }
        // Every visible text node's line boxes, against the motif boxes (a hidden motif has an empty box).
        const texts: { left: number; right: number; top: number; bottom: number }[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim() || !node.parentElement?.checkVisibility()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of range.getClientRects())
            texts.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        }
        return { main: main.toJSON(), paper: paper.toJSON(), out, texts };
      });
      const { vine, stars } = { vine: result.out['gutter-vine']!, stars: result.out['gutter-stars']! };
      expect(vine.display).toBe('block');
      expect(result.paper.right - vine.left).toBeLessThan(0);
      expect(vine.left - result.paper.right).toBeGreaterThanOrEqual(4 - 0.5);
      expect(result.main.right - vine.right).toBeGreaterThanOrEqual(4 - 0.5);
      const meets = (a: { left: number; right: number; top: number; bottom: number }) =>
        result.texts.some((t) => t.left < a.right && t.right > a.left && t.top < a.bottom && t.bottom > a.top);
      expect(meets(vine)).toBe(false);
      if (theme === 'dark') expect(meets(stars)).toBe(false);
      if (theme === 'dark') {
        expect(stars.display).toBe('block');
        expect(result.paper.left - stars.right).toBeGreaterThanOrEqual(-0.5);
      } else expect(stars.display).toBe('none');
    });
  }

  const hidden = async (page: Page) => {
    for (const name of ['gutter-vine', 'gutter-stars'])
      expect(await page.locator(`[data-art="${name}"]`).evaluate((e) => getComputedStyle(e).display)).toBe('none');
  };

  test('are hidden at 125 percent and under more contrast', async ({ page }) => {
    await openPage(page, { theme: 'dark' });
    await expectGutter(page, 24);
    await zoomTo(page, 125);
    await expectGutter(page, 19);
    await hidden(page);
    await page.emulateMedia({ contrast: 'more', colorScheme: 'dark' } as never);
    await zoomTo(page, 100);
    await expectGutter(page, 24);
    await hidden(page);
  });

  test('are hidden with a page pane open', async ({ page }) => {
    await openPage(page, { theme: 'dark', width: 1920 });
    await expectGutter(page, 24);
    await runCommand(page, 'Reading order');
    await expect(page.getByRole('complementary', { name: 'Reading order' })).toBeVisible();
    await expectGutter(page, 0);
    await hidden(page);
  });

  test('are hidden with Paper in the dark theme', async ({ page }) => {
    await openPage(page, { theme: 'dark', paper: true, width: 1920 });
    await expectGutter(page, 0);
    await hidden(page);
  });

  test('@forced are hidden under forced colors', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await openPage(page);
    await expectGutter(page, 0);
    await hidden(page);
  });
});

for (const theme of ['light', 'dark'] as const) {
  test(`the strips stay within 1.5:1 of the sunken canvas in ${theme}`, async ({ page }) => {
    await openPage(page, { theme });
    await expectGutter(page, 24);
    await quiet(page);
    const sunken = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--color-surface-sunken)';
      document.body.append(probe);
      const [r, g, b] = getComputedStyle(probe).color.match(/\d+/g)!.map(Number);
      probe.remove();
      return [r, g, b] as [number, number, number];
    });
    const { main } = await boxes(page);
    const motifs = await page.evaluate(() =>
      [...document.querySelectorAll('[data-art^="gutter"]')].map((e) => e.getBoundingClientRect().toJSON()),
    );
    for (const side of [main.left, main.right - 24]) {
      for (const point of await samples(page, { x: side, y: main.top + 40, width: 24, height: 600 })) {
        const x = side + point.x;
        const y = main.top + 40 + point.y;
        if (motifs.some((m) => x >= m.left - 2 && x <= m.right + 2 && y >= m.top - 2 && y <= m.bottom + 2)) continue;
        expect(ratio(point.rgb, sunken)).toBeLessThanOrEqual(1.5);
      }
    }
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`a pixel 12 px into each strip is not the page color in ${theme}`, async ({ page }) => {
    await openPage(page, { theme });
    await expectGutter(page, 24);
    await quiet(page);
    const surface = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--color-surface-page)';
      document.body.append(probe);
      const [r, g, b] = getComputedStyle(probe).color.match(/\d+/g)!.map(Number);
      probe.remove();
      return [r, g, b] as [number, number, number];
    });
    const { main } = await boxes(page);
    for (const x of [main.left + 12, main.right - 12]) {
      const [pixel] = await samples(page, { x, y: main.top + 300, width: 4, height: 4 });
      expect(pixel!.rgb).not.toEqual(surface);
    }
  });
}

test('nothing in the strip animates, with or without reduced motion, also after the pages pane is collapsed', async ({
  page,
}) => {
  await openPage(page, { theme: 'dark' });
  await expectGutter(page, 24);
  await page.waitForTimeout(1000);
  // What animates in main: the strips, the motifs, and the page card itself (article, the editing surface). Only the
  // page's own inner parts may (a spinner, a caret).
  const names = () =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation) => animation.playState !== 'finished')
        .map((animation) => (animation.effect as KeyframeEffect | null)?.target as Element | null)
        .filter(
          (target): target is Element =>
            Boolean(target?.closest('main')) && (target?.tagName === 'ARTICLE' || !target?.closest('article')),
        )
        .map((target) => `${target.tagName} ${target.getAttribute('class') ?? ''}`),
    );
  expect(await names()).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await names()).toEqual([]);
  const separator = page.getByRole('separator', { name: 'Resize the pages pane' });
  await separator.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Show pages' })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await names()).toEqual([]);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Show pages' })).toBeHidden();
  await page.waitForTimeout(1000);
  expect(await names()).toEqual([]);
});
