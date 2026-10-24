// The pseudo-locale pass (A4-37, ARCHITECTURE.md section 19.4): every registered screen state opens with each string
// stretched by 40% and wrapped in markers. A screen fails when the page scrolls sideways, when text is clipped by a
// box that neither wraps nor shows an ellipsis, or when visible interface text has no markers, which means it
// skipped t(). The pseudo-locale project runs the tests tagged @pseudo. Only screens marked `pseudo` are visited,
// because their steps find controls by names that match in both locales (tests/ui/pseudoName.ts).

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { loadScreens, openScreen } from '../screens';
import type { SizeClass } from '../screens';

const screens = await loadScreens();
const SIZES: readonly SizeClass[] = ['compact', 'wide'];

/** Where the person's own words live: notes, titles, tree rows, and text fields hold data, not interface strings. */
const DATA = '[contenteditable], [role="tree"], [role="textbox"], textarea, input, [data-user-content], pre, code, svg';

async function problems(page: Page): Promise<string[]> {
  return page.evaluate((dataSelector) => {
    const found: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1)
      found.push(`The page scrolls sideways (${root.scrollWidth} > ${root.clientWidth}).`);
    // Weekday and month names come from the date formatter, in the person's language, and are not t() strings.
    const dates =
      /^(?:(?:mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[.,]?\s*|\d+\s*)+$/i;
    const surface = [...document.querySelectorAll('[role="dialog"], [data-workspace] main, main')];
    const visible = (el: Element) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    for (const area of surface) {
      const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const text = node.data.trim();
        const parent = node.parentElement;
        if (!parent || text.length < 3 || !/[A-Za-z]{3,}/.test(text) || !visible(parent)) continue;
        if (parent.closest(dataSelector) || parent.closest('[aria-hidden="true"], script, style')) continue;
        // Math keys and a microphone's own name are not interface strings: they are marked translate="no".
        if (parent.closest('[translate="no"]')) continue;
        if (dates.test(text)) continue;
        if (!text.includes('⟦') && !text.includes('⟧')) found.push(`No pseudo-locale markers: "${text.slice(0, 60)}"`);
      }
      for (const el of area.querySelectorAll<HTMLElement>('*')) {
        if (!visible(el) || el.closest(dataSelector)) continue;
        const style = getComputedStyle(el);
        const clips = style.overflowX === 'hidden' || style.overflowX === 'clip';
        if (
          clips &&
          style.textOverflow !== 'ellipsis' &&
          el.scrollWidth > el.clientWidth + 2 &&
          el.children.length === 0
        ) {
          found.push(`Clipped text: "${(el.textContent ?? '').trim().slice(0, 60)}"`);
        }
      }
    }
    return [...new Set(found)];
  }, DATA);
}

for (const screen of screens.filter((entry) => entry.pseudo)) {
  for (const size of SIZES.filter((s) => !screen.sizes || screen.sizes.includes(s))) {
    test(`${screen.id} has no clipped or untranslated text at ${size} @pseudo`, async ({ page, pseudoLocale }) => {
      test.skip(!pseudoLocale, 'Runs in the pseudo-locale project only.');
      await openScreen(page, screen, { size, theme: 'light' });
      expect(await problems(page)).toEqual([]);
    });
  }
}
