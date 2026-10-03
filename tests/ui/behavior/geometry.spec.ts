// Geometry on every registered screen state (tests/ui/screens/*.ts). Nothing spills past the window, the window
// itself never scrolls, and a dialog never scrolls around its own content. Every focus ring that Tab shows is
// whole. A centered button's or card's content sits within 1 px of its middle. No table cell's content runs past
// the cell, a wrapped choice leaves no card alone on its last row, and the cards of one choice share one width. A
// screenshot review found these defects by eye, and the checks keep them fixed.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { loadScreens, openScreen, settle } from '../screens';
import type { ScreenState, SizeClass } from '../screens';

const screens = await loadScreens();
const SIZES: readonly SizeClass[] = ['expanded', 'wide'];

/** A short window, 820x620, where tall dialogs and scrollers ran out of room. */
const SHORT = { width: 820, height: 620 };

/** The most Tab presses a focus walk takes on one screen. */
const TAB_STOPS = 40;

// A long screen, such as the shortcut list, takes about 25 s for its 40 Tab stops and its measures.
test.describe.configure({ timeout: 60_000 });

interface Geometry {
  sideways: number;
  /** How far the document itself scrolls down. The app scrolls inside its panes, never the whole window. */
  downward: number;
  dialogs: { name: string; overflow: number; bottomGap: number; drawer: boolean }[];
  offCenter: string[];
}

/** Measures the page as it is: sideways scroll, each dialog's own scroll and room, and off-center buttons. */
function measure(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1 && getComputedStyle(el).visibility === 'visible';
    };
    const name = (el: Element) =>
      el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? el.tagName.toLowerCase();
    const dialogs = [...document.querySelectorAll('[role="dialog"], dialog[open]')].filter(visible).map((el) => {
      const dialog = el as HTMLElement;
      return {
        name: name(dialog),
        overflow: dialog.scrollHeight - dialog.clientHeight,
        bottomGap: window.innerHeight - dialog.getBoundingClientRect().bottom,
        drawer: dialog.closest('[data-placement="start"]') !== null,
      };
    });
    const offCenter: string[] = [];
    for (const button of document.querySelectorAll('button, [role="button"]')) {
      if (!visible(button)) continue;
      const style = getComputedStyle(button);
      if (!style.display.includes('flex') && !style.display.includes('grid')) continue;
      const range = document.createRange();
      range.selectNodeContents(button);
      const content = range.getBoundingClientRect();
      if (content.width === 0) continue;
      const box = button.getBoundingClientRect();
      const left = box.left + button.clientLeft + parseFloat(style.paddingLeft);
      const right = box.right - (box.width - button.clientLeft - button.clientWidth) - parseFloat(style.paddingRight);
      const top = box.top + button.clientTop + parseFloat(style.paddingTop);
      const bottom =
        box.bottom - (box.height - button.clientTop - button.clientHeight) - parseFloat(style.paddingBottom);
      const dx = (content.left + content.right) / 2 - (left + right) / 2;
      const dy = (content.top + content.bottom) / 2 - (top + bottom) / 2;
      // A grid card, such as a text size choice, centers its label with justify-items.
      const centersX =
        style.justifyContent === 'center' || (style.display.includes('grid') && style.justifyItems === 'center');
      const centersY = style.alignItems === 'center';
      if ((centersX && Math.abs(dx) > 1) || (centersY && Math.abs(dy) > 1)) {
        offCenter.push(`${name(button)}: ${dx.toFixed(1)}, ${dy.toFixed(1)} px off center`);
      }
    }
    const root = document.documentElement;
    return {
      sideways: root.scrollWidth - window.innerWidth,
      downward: root.scrollHeight - window.innerHeight,
      dialogs,
      offCenter,
    };
  });
}

interface SideBySide {
  /** Table cell contents that run past their cell, such as a key cap under the next column's button. */
  spills: string[];
  /** Choices that wrap and leave a last row less than half as full as the first, such as 175% and 200% alone. */
  lonely: string[];
  /** Choices in the main content whose cards differ in width, so their edges don't line up. */
  ragged: string[];
}

/** Measures what sits side by side: each table cell's contents, and the cards of each choice. */
function measureSideBySide(page: Page): Promise<SideBySide> {
  return page.evaluate(() => {
    const shown = (el: Element) => el.getBoundingClientRect().width > 1 && el.getBoundingClientRect().height > 1;
    const spills: string[] = [];
    for (const cell of [...document.querySelectorAll('td, th')].filter(shown)) {
      const box = cell.getBoundingClientRect();
      const over = Math.max(
        0,
        ...[...cell.querySelectorAll('*')].map((child) => {
          const rect = child.getBoundingClientRect();
          return rect.width ? Math.max(rect.right - box.right, box.left - rect.left) : 0;
        }),
      );
      if (over > 0.5) spills.push(`${cell.textContent?.trim().slice(0, 40)}: ${over.toFixed(1)} px past its cell`);
    }
    const lonely: string[] = [];
    const ragged: string[] = [];
    for (const group of document.querySelectorAll('[role="radiogroup"]')) {
      const cards = [...group.querySelectorAll('[role="radio"]')].filter(shown).map((c) => c.getBoundingClientRect());
      const label = group.getAttribute('aria-label') ?? '';
      const tops = [...new Set(cards.map((card) => Math.round(card.top)))];
      const rows = tops.map((top) => cards.filter((card) => Math.round(card.top) === top).length);
      if (rows.length > 1 && rows[rows.length - 1] * 2 < rows[0]) lonely.push(`${label}: rows of ${rows.join(' + ')}`);
      const widths = cards.map((card) => card.width);
      if (group.closest('main') && Math.max(...widths) - Math.min(...widths) > 1) {
        ragged.push(`${label}: ${widths.map((width) => width.toFixed(0)).join(', ')} px`);
      }
    }
    return { spills, lonely, ragged };
  });
}

/**
 * Where the focused element's ring is cut: by the window or by an ancestor that clips its overflow and contains it.
 * Returns nothing when the ring is whole or the element draws none.
 */
function ringCut(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el.isContentEditable) return null;
    const style = getComputedStyle(el);
    const width = parseFloat(style.outlineWidth);
    if (style.outlineStyle === 'none' || !width) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return null;
    const grow = parseFloat(style.outlineOffset) + width;
    const ring = { left: rect.left - grow, top: rect.top - grow, right: rect.right + grow, bottom: rect.bottom + grow };
    const label = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? el.tagName;
    const cut = (box: { left: number; top: number; right: number; bottom: number }, by: string) => {
      const sides = [
        ['left', box.left - ring.left],
        ['top', box.top - ring.top],
        ['right', ring.right - box.right],
        ['bottom', ring.bottom - box.bottom],
      ].filter(([, amount]) => (amount as number) > 0.5);
      return sides.length
        ? `${el.getAttribute('role') ?? el.tagName.toLowerCase()} "${label}": cut ${sides
            .map(([side, amount]) => `${side} ${(amount as number).toFixed(1)}`)
            .join(', ')} by ${by}`
        : null;
    };
    const byWindow = cut({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }, 'the window');
    if (byWindow) return byWindow;
    // Walk the containing blocks: an ancestor clips a fixed or absolute descendant only when it contains it.
    let mode = style.position;
    for (let node = el.parentElement; node; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.display === 'contents') continue;
      const transformed =
        s.transform !== 'none' || s.filter !== 'none' || /paint|layout|strict|content/.test(s.contain);
      if (mode === 'fixed' && !transformed) continue;
      if (mode === 'absolute' && s.position === 'static' && !transformed) continue;
      mode = s.position === 'fixed' || s.position === 'absolute' ? s.position : 'static';
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const box = node.getBoundingClientRect();
      const left = box.left + node.clientLeft;
      const top = box.top + node.clientTop;
      const result = cut(
        { left, top, right: left + node.clientWidth, bottom: top + node.clientHeight },
        `${node.tagName.toLowerCase()}.${[...node.classList].join('.')}`,
      );
      if (result) return result;
    }
    return null;
  });
}

/** Presses Tab through the screen and lists every focus ring that is cut. Stops when focus comes round again. */
async function focusWalk(page: Page): Promise<string[]> {
  const cuts: string[] = [];
  const seen = new Set<string>();
  for (let stop = 0; stop < TAB_STOPS; stop += 1) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return 'body';
      if ((el as HTMLElement).isContentEditable) return 'editor';
      const path: string[] = [];
      for (let node: Element | null = el; node; node = node.parentElement) {
        path.push(`${node.tagName}${node.parentElement ? [...node.parentElement.children].indexOf(node) : ''}`);
      }
      return path.join('<');
    });
    // The editor takes Tab for itself, and a second visit means the walk has gone round.
    if (id === 'editor' || seen.has(id)) break;
    seen.add(id);
    const cut = await ringCut(page);
    if (cut) cuts.push(cut);
  }
  return cuts;
}

async function expectSound(page: Page, screen: ScreenState) {
  const geometry = await measure(page);
  expect(geometry.sideways, 'the page scrolls sideways').toBeLessThanOrEqual(0);
  expect(geometry.downward, 'the whole window scrolls, title bar and all').toBeLessThanOrEqual(0);
  for (const dialog of geometry.dialogs) {
    expect(dialog.overflow, `the dialog "${dialog.name}" scrolls around its own content`).toBeLessThanOrEqual(1);
    if (!dialog.drawer) {
      expect(dialog.bottomGap, `the dialog "${dialog.name}" reaches the window's bottom edge`).toBeGreaterThan(8);
    }
  }
  expect(geometry.offCenter, `off-center button content on ${screen.id}`).toEqual([]);
  const sideBySide = await measureSideBySide(page);
  expect(sideBySide.spills, `table cell contents past their cells on ${screen.id}`).toEqual([]);
  expect(sideBySide.lonely, `choices wrapping to a near-empty last row on ${screen.id}`).toEqual([]);
  expect(sideBySide.ragged, `choices with cards of different widths on ${screen.id}`).toEqual([]);
  expect(await focusWalk(page), `cut focus rings on ${screen.id}`).toEqual([]);
}

for (const screen of screens) {
  for (const size of SIZES.filter((each) => !screen.sizes || screen.sizes.includes(each))) {
    test(`${screen.id} keeps its geometry at ${size}`, async ({ page }) => {
      await openScreen(page, screen, { size, theme: 'light' });
      await expectSound(page, screen);
    });
  }

  test(`${screen.id} keeps its geometry in a short window`, async ({ page }) => {
    await openScreen(page, screen, { size: screen.sizes?.[0] ?? 'expanded', theme: 'light' });
    await page.setViewportSize(SHORT);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expectSound(page, screen);
  });
}

test('the setup theme cards center under the step heading within 1 px', async ({ page }) => {
  const look = screens.find((screen) => screen.id === 'setup.look');
  if (!look) throw new Error('The setup.look screen is not registered.');
  for (const size of ['expanded', 'wide'] as const) {
    await openScreen(page, look, { size, theme: 'light' });
    const offset = await page.evaluate(() => {
      const group = document.querySelector('[role="radiogroup"]');
      const heading = document.querySelector('h1, h2');
      if (!group || !heading) return Number.NaN;
      const cards = [...group.querySelectorAll('[role="radio"]')].map((card) => card.getBoundingClientRect());
      const middle = (Math.min(...cards.map((card) => card.left)) + Math.max(...cards.map((card) => card.right))) / 2;
      const title = heading.getBoundingClientRect();
      return middle - (title.left + title.right) / 2;
    });
    expect(Math.abs(offset)).toBeLessThanOrEqual(1);
  }
});

test('the setup theme cards meet the footer edges and keep their height when the choice changes', async ({ page }) => {
  const look = screens.find((screen) => screen.id === 'setup.look');
  if (!look) throw new Error('The setup.look screen is not registered.');
  const row = () =>
    page.evaluate(() => {
      const cards = [...document.querySelectorAll('[role="radiogroup"] [role="radio"]')].map((card) =>
        card.getBoundingClientRect(),
      );
      const footer = [...document.querySelectorAll('button')]
        .filter((button) => ['Back', 'Continue'].includes(button.textContent?.trim() ?? ''))
        .map((button) => button.getBoundingClientRect());
      return {
        start: Math.min(...cards.map((card) => card.left)) - Math.min(...footer.map((button) => button.left)),
        end: Math.max(...cards.map((card) => card.right)) - Math.max(...footer.map((button) => button.right)),
        height: Math.max(...cards.map((card) => card.height)),
      };
    });
  for (const size of ['expanded', 'wide'] as const) {
    await openScreen(page, look, { size, theme: 'light' });
    const before = await row();
    expect(Math.abs(before.start), 'the cards start where Back does').toBeLessThanOrEqual(1);
    expect(Math.abs(before.end), 'the cards end where Continue does').toBeLessThanOrEqual(1);
    // The Match Windows caption that says why it was preselected gives way to a one-line caption.
    await page.getByRole('radio', { name: /Dark/ }).click();
    await settle(page);
    expect(Math.abs((await row()).height - before.height), 'the row jumps').toBeLessThanOrEqual(0.5);
  }
});
