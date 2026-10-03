// The desk-by-the-window look in the production build (docs/BRAND.md sections 4, 8, and 9): the drawings never sit on
// text, nothing loops, reduced motion removes the fade-in, and the ambient canvas lies behind the opaque page card.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { loadScreens, openScreen, settle } from '../screens';
import type { ScreenState, SizeClass, Theme } from '../screens';

const screens = await loadScreens();
const byId = (id: string): ScreenState => {
  const screen = screens.find((candidate) => candidate.id === id);
  if (!screen) throw new Error(`No screen state ${id}`);
  return screen;
};

const THEMES: readonly Theme[] = ['light', 'dark'];
const SIZES: readonly SizeClass[] = ['compact', 'wide'];
const DRAWN = [
  'setup.welcome',
  'setup.look',
  'setup.storage',
  'workspace.sample',
  'workspace.empty',
  'trash.empty',
  'settings.appearance',
  'settings.about',
];

/**
 * The drawings and marks: every hidden svg that cannot take focus. The logo is one, beside the app name. The star
 * field is left out because it is the sky itself, under the opaque page card; its own test checks that.
 */
const STARS = 'svg[viewBox="0 0 1280 160"]';
const DRAWINGS = `svg[aria-hidden="true"][focusable="false"]:not(${STARS})`;

/** The text of every text node whose box meets a drawing's box. */
async function overlaps(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const clash: string[] = [];
    const boxes: { text: string; rect: DOMRect }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const parent = node.parentElement;
      if (!text || !parent || parent.closest('svg, script, style')) continue;
      if (getComputedStyle(parent).visibility === 'hidden') continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) boxes.push({ text, rect });
    }
    for (const art of document.querySelectorAll(selector)) {
      const a = art.getBoundingClientRect();
      if (a.width === 0 || a.height === 0) continue;
      for (const { text, rect: t } of boxes) {
        const apart =
          a.right <= t.left + 0.5 || t.right <= a.left + 0.5 || a.bottom <= t.top + 0.5 || t.bottom <= a.top + 0.5;
        if (!apart) clash.push(text);
      }
    }
    return clash;
  }, DRAWINGS);
}

for (const id of DRAWN) {
  for (const theme of THEMES) {
    for (const size of SIZES) {
      test(`${id} draws nothing over its text at ${size} in ${theme}`, async ({ page }) => {
        await openScreen(page, byId(id), { size, theme });
        // A settings section loads after its heading, so wait for the first drawing to arrive.
        await expect(page.locator(DRAWINGS).first()).toBeAttached();
        await settle(page);
        expect(await overlaps(page)).toEqual([]);
      });
    }
  }
}

for (const theme of THEMES) {
  test(`loops nothing once the page has settled, in ${theme}`, async ({ page }) => {
    await openScreen(page, byId('workspace.sample'), { size: 'wide', theme });
    const looping = await page.evaluate(
      () =>
        document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity)
          .length,
    );
    expect(looping).toBe(0);
  });

  test(`lays the ambient canvas behind an opaque page card, in ${theme}`, async ({ page }) => {
    await openScreen(page, byId('workspace.sample'), { size: 'wide', theme });
    const found = await page.evaluate((starSelector) => {
      const card = document.querySelector('article') as HTMLElement;
      const stars = document.querySelector<SVGElement>(starSelector);
      let canvas: HTMLElement | null = card.parentElement;
      while (canvas && getComputedStyle(canvas).backgroundImage === 'none') canvas = canvas.parentElement;
      const box = card.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + 24);
      return {
        canvas: Boolean(canvas),
        canvasHoldsCard: Boolean(canvas?.contains(card)),
        canvasIsolated: canvas ? getComputedStyle(canvas).isolation : null,
        cardBackground: getComputedStyle(card).backgroundColor,
        cardOnTop: Boolean(top && card.contains(top)),
        starsDisplay: stars ? getComputedStyle(stars).display : null,
        starsLayer: stars ? getComputedStyle(stars).zIndex : null,
      };
    }, STARS);
    expect(found.canvas).toBe(true);
    expect(found.canvasHoldsCard).toBe(true);
    expect(found.canvasIsolated).toBe('isolate');
    expect(found.cardBackground).toMatch(/^rgb\(/);
    expect(found.cardOnTop).toBe(true);
    // The stars are only in the evening sky, and always under the card.
    expect(found.starsDisplay).toBe(theme === 'dark' ? 'block' : 'none');
    expect(Number(found.starsLayer)).toBeLessThan(0);
  });
}

test('fades the drawings in once, and not at all with reduced motion', async ({ page }) => {
  const fade = () =>
    page.evaluate(() => {
      const art = document.querySelector('svg[aria-hidden="true"][focusable="false"][viewBox="0 0 240 150"]');
      return art ? getComputedStyle(art).animationName : null;
    });
  await openScreen(page, byId('setup.welcome'), { size: 'wide', theme: 'light' });
  expect(await fade()).not.toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome to OpenNote' })).toBeVisible();
  expect(await fade()).toBe('none');
});

test('keeps the plant out of the way in the compact layout', async ({ page }) => {
  await openScreen(page, byId('workspace.sample'), { size: 'compact', theme: 'light' });
  const shown = await page.evaluate(
    () =>
      [...document.querySelectorAll('svg[viewBox="0 0 48 66"]')].filter((svg) => svg.getBoundingClientRect().width > 0)
        .length,
  );
  expect(shown).toBe(0);
});
