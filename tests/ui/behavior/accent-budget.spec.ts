// The accent budget of the shell (docs/BRAND.md section 4), measured on the rendered screens. Each family of color has one
// job: moss marks state, the notebook's pen marks place, clay is the brand's mark, and candle, dusk and night mark the
// time of day. The static half is the CHECKS rule accent-roles. This is the rendered half: it counts the tagged
// notebook marks, finds colors that sit where they should not, and checks that nothing loops.

import type { Page } from '@playwright/test';
import { tokens } from '../../../app/src/theme/tokens';
import { expect, test } from '../fixtures';
import { loadScreens, openScreen } from '../screens';
import type { ScreenState, Theme } from '../screens';

const screens = await loadScreens();
const byId = (id: string): ScreenState => {
  const screen = screens.find((candidate) => candidate.id === id);
  if (!screen) throw new Error(`No screen state ${id}`);
  return screen;
};

const THEMES: readonly Theme[] = ['light', 'dark'];
const SIZES = [
  { name: '1280 by 800', width: 1280, height: 800 },
  { name: '720 by 900', width: 720, height: 900 },
] as const;

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** The time-of-day accents in a theme, as the browser prints them. */
function timeOfDay(theme: Theme): string[] {
  const { accent } = tokens.color[theme];
  return [accent.candle, accent.dusk, accent.night].map(rgb);
}

/** What the walk skips: note content, drawings, theme previews, chips, swatches, the theme toggle's icon. */
const EXEMPT = [
  '[data-region=page] .ProseMirror',
  '[data-ink-overlay]',
  'svg[focusable="false"]',
  '[data-theme-scope]',
  '[data-color-swatch]',
  '[data-theme-toggle]',
  '[data-color]',
  '[class*="chip" i]',
  '[data-ink-slot]',
  '[data-ink-color]',
  '[data-ink-width]',
].join(', ');

interface Walk {
  /** Elements whose paint used a time-of-day accent, with what they are. */
  timeOfDayUses: string[];
  /** Buttons, tabs, and button roles with a candle, dusk or night background. */
  timeOfDayBackgrounds: string[];
  /** Tagged marks by kind. */
  marks: string[];
  /** Tagged marks that do not paint the notebook's pen, by kind. */
  unpainted: string[];
  /** Elements painted with the notebook's pen that carry no mark. */
  untaggedPen: string[];
  /** Animations still running that loop forever. */
  loops: number;
}

async function walk(page: Page, theme: Theme, pen: string | null): Promise<Walk> {
  const forbidden = timeOfDay(theme);
  return page.evaluate(
    ({ forbidden, exempt, pen }) => {
      const describe = (element: Element) =>
        `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${
          element.getAttribute('aria-label') ? `[${element.getAttribute('aria-label')}]` : ''
        }`;
      const paints = (element: Element, pseudo?: string) => {
        const style = getComputedStyle(element, pseudo);
        const shadow = style.boxShadow === 'none' ? '' : style.boxShadow;
        return [
          style.color,
          style.backgroundColor,
          style.borderTopColor,
          style.borderBottomColor,
          style.outlineStyle === 'none' ? '' : style.outlineColor,
          style.fill,
          style.stroke,
          shadow,
        ].join(' ');
      };
      const result: Walk = {
        timeOfDayUses: [],
        timeOfDayBackgrounds: [],
        marks: [],
        unpainted: [],
        untaggedPen: [],
        loops: 0,
      };
      for (const element of document.querySelectorAll('body *')) {
        if (element.closest(exempt)) continue;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const kind = (element as HTMLElement).dataset?.notebookMark;
        const seen = [paints(element), paints(element, '::before'), paints(element, '::after')].join(' ');
        if (forbidden.some((color) => seen.includes(color))) result.timeOfDayUses.push(describe(element));
        if (
          element.matches('button, [role=button], [role=tab]') &&
          forbidden.includes(style.backgroundColor) &&
          !element.closest('[data-theme-toggle]')
        )
          result.timeOfDayBackgrounds.push(describe(element));
        if (kind) {
          result.marks.push(kind);
          if (!pen || !seen.includes(pen)) result.unpainted.push(kind);
        } else if (pen && !element.closest('[data-notebook-mark]') && seen.includes(pen)) {
          result.untaggedPen.push(describe(element));
        }
      }
      result.loops = document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === 'running' && animation.effect?.getComputedTiming().iterations === Infinity,
        ).length;
      return result;
    },
    { forbidden, exempt: EXEMPT, pen },
  );
}

async function penOf(page: Page, name: string): Promise<string> {
  return page.evaluate((variable) => {
    const probe = document.body.appendChild(document.createElement('div'));
    probe.style.color = `var(${variable})`;
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, `--ink-${name}`);
}

async function colorNotebook(page: Page, name: string, color: string): Promise<void> {
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Color' }).click();
  await page.getByRole('menuitemradio', { name: color }).click();
}

/** A Plum notebook with an Amber section, and a second tab from a notebook with no color. */
async function plumScreen(page: Page, uncoloredActive: boolean): Promise<void> {
  await page.goto('/');
  await colorNotebook(page, 'Biology 101', 'Plum');
  await colorNotebook(page, 'Work', 'No color');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Labs' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Photosynthesis lab' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Photosynthesis lab' })).toBeVisible();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Photosynthesis lab' }).focus();
  await page.keyboard.press('Control+Enter');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Work' }).click();
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Meetings' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Weekly sync' }).click();
  const tabs = page.getByRole('tablist', { name: 'Open pages' });
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await (uncoloredActive ? tabs.getByRole('tab').last() : tabs.getByRole('tab').first()).click();
  await page.waitForTimeout(300);
}

for (const theme of THEMES) {
  for (const size of SIZES) {
    const where = `${theme}, ${size.name}`;
    test.describe(where, () => {
      test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript(
          (appearance) => {
            window.__OPENNOTE_BOOT__ = { settings: { appearance }, bootVersion: 1 } as never;
          },
          { theme },
        );
      });

      test(`the Plum screen shows the notebook marks and keeps every other limit @forced`, async ({ page }) => {
        await plumScreen(page, false);
        await page.setViewportSize({ width: size.width, height: size.height });
        const result = await walk(page, theme, await penOf(page, 'plum'));
        expect(result.timeOfDayUses).toEqual([]);
        expect(result.timeOfDayBackgrounds).toEqual([]);
        expect(result.unpainted).toEqual([]);
        expect(result.loops).toBe(0);
        const kinds = [...new Set(result.marks)].sort();
        if (size.width >= 1000) expect(kinds).toEqual(['breadcrumb', 'tab', 'title-rule']);
        else {
          expect(kinds).toContain('title-rule');
          expect(kinds.length).toBeLessThanOrEqual(3);
        }
        // No mark in the page list, and nothing else painted with the pen.
        await expect(page.getByRole('tree', { name: 'Pages' }).locator('[data-notebook-mark]')).toHaveCount(0);
        expect(result.untaggedPen).toEqual([]);
      });

      test(`the uncolored screen shows no notebook mark and a clay rule`, async ({ page }) => {
        await plumScreen(page, true);
        await page.setViewportSize({ width: size.width, height: size.height });
        const result = await walk(page, theme, null);
        expect(result.marks).toEqual([]);
        expect(result.timeOfDayUses).toEqual([]);
        const clay = rgb(tokens.color[theme].accent.clay);
        const rule = await page
          .locator('article h1, [data-page-title]')
          .first()
          .evaluate((element) => getComputedStyle(element, '::after').backgroundColor);
        expect(rule).toBe(clay);
      });

      test('the empty home screen holds the limits', async ({ page }) => {
        await openScreen(page, byId('workspace.empty'), { size: 'wide', theme });
        await page.setViewportSize({ width: size.width, height: size.height });
        const result = await walk(page, theme, null);
        expect(result.timeOfDayUses).toEqual([]);
        expect(result.marks).toEqual([]);
        expect(result.loops).toBe(0);
      });

      for (const tab of ['Home', 'Insert', 'Draw', 'View']) {
        test(`the ${tab} tab holds the limits`, async ({ page }) => {
          await page.goto('/');
          await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
          await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
          await page.getByRole('tab', { name: tab }).click();
          await page.setViewportSize({ width: size.width, height: size.height });
          const result = await walk(page, theme, null);
          expect(result.timeOfDayUses).toEqual([]);
          expect(result.timeOfDayBackgrounds).toEqual([]);
          expect(result.loops).toBe(0);
        });
      }

      for (const id of ['settings.appearance', 'setup.welcome']) {
        test(`the ${id} screen holds the limits`, async ({ page }) => {
          await openScreen(page, byId(id), { size: 'wide', theme });
          await page.setViewportSize({ width: size.width, height: size.height });
          const result = await walk(page, theme, null);
          expect(result.timeOfDayUses).toEqual([]);
          expect(result.timeOfDayBackgrounds).toEqual([]);
          expect(result.loops).toBe(0);
        });
      }
    });
  }
}

test('the walk fails when a tool icon is tinted with candle', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await page.addStyleTag({
    content: '[role=toolbar] button svg { color: var(--color-accent-candle) !important; }',
  });
  const result = await walk(page, 'light', null);
  expect(result.timeOfDayUses.length).toBeGreaterThan(0);
});
