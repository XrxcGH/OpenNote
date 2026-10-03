// Shared steps for WP3's page specs (Phase 4 PLAN.md section 7.5): open the empty Mitosis page in the real app,
// make floating text boxes on it, and read blocks back by their accessible names.

import { launchApp } from '../harness.ts';
import type { AppSession, Browser, LaunchOptions } from '../harness.ts';

/** Clicks the row of a tree whose label reads `name`, once it shows. */
async function clickRow(browser: Browser, tree: string, name: string): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (tree, name) => {
          const rows = document.querySelectorAll(`[role="tree"][aria-label="${tree}"] [role="treeitem"]`);
          const row = [...rows].find(
            (candidate) =>
              document.getElementById(candidate.getAttribute('aria-labelledby') ?? '')?.textContent === name,
          );
          (row as HTMLElement | undefined)?.click();
          return Boolean(row);
        },
        tree,
        name,
      ),
    { timeout: 20_000 },
  );
}

/** Launches the app and opens the empty Mitosis page, waiting for its text. */
export async function openEmptyPage(options: LaunchOptions = {}): Promise<AppSession> {
  const session = await launchApp(options);
  await clickRow(session.browser, 'Notebooks', 'Lectures');
  await clickRow(session.browser, 'Pages', 'Mitosis');
  await session.browser.$('[role="textbox"][aria-label="Page text"]').waitForExist({ timeout: 20_000 });
  return session;
}

/** The client point of a page-unit point, through the page's own layers. */
export async function clientPoint(browser: Browser, x: number, y: number): Promise<{ x: number; y: number }> {
  return browser.execute(
    (x, y) => {
      // The title band is the world's first child, so its grandparent is the world.
      const world = document.querySelector<HTMLElement>('h1[data-page-title]')!.parentElement!.parentElement!;
      const box = world.getBoundingClientRect();
      const zoom = box.width / world.offsetWidth;
      return { x: box.left + x * zoom, y: box.top + y * zoom };
    },
    x,
    y,
  );
}

/** Presses and releases the mouse at a client point, with moves between, through WebDriver actions. */
export async function drag(browser: Browser, from: { x: number; y: number }, to: { x: number; y: number }) {
  await browser
    .action('pointer', { parameters: { pointerType: 'mouse' } })
    .move({ x: Math.round(from.x), y: Math.round(from.y) })
    .down({ button: 0 })
    .move({ x: Math.round((from.x + to.x) / 2), y: Math.round((from.y + to.y) / 2), duration: 100 })
    .move({ x: Math.round(to.x), y: Math.round(to.y), duration: 100 })
    .up({ button: 0 })
    .perform();
}

/** Clicks at a client point. */
export async function clickAt(browser: Browser, point: { x: number; y: number }): Promise<void> {
  await browser
    .action('pointer', { parameters: { pointerType: 'mouse' } })
    .move({ x: Math.round(point.x), y: Math.round(point.y) })
    .down({ button: 0 })
    .up({ button: 0 })
    .perform();
}

/** The floating text boxes, by name, with their page-unit positions from their inline styles. */
export async function textBoxes(
  browser: Browser,
): Promise<{ name: string; text: string; left: number; top: number }[]> {
  return browser.execute(() =>
    [...document.querySelectorAll<HTMLElement>('[role="textbox"][aria-label^="Text box"]')].map((root) => {
      const wrapper = root.closest<HTMLElement>('[data-block-id]')!;
      return {
        name: root.getAttribute('aria-label') ?? '',
        text: root.textContent ?? '',
        left: parseFloat(wrapper.style.left),
        top: parseFloat(wrapper.style.top),
      };
    }),
  );
}

/** Makes a floating text box at a page-unit point by clicking there and typing. */
export async function makeBox(browser: Browser, x: number, y: number, text: string): Promise<void> {
  await clickAt(browser, await clientPoint(browser, x, y));
  await browser.keys(text);
  await browser.waitUntil(async () => (await textBoxes(browser)).some((box) => box.text === text), { timeout: 5_000 });
}
