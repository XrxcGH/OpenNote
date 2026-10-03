// The typing benchmark's conditions (Phase 4 ARCHITECTURE.md sections 24.2 and 26.4): each opens a seeded page in
// the web build and puts the caret where the keys go. The web platform serves the page fixture the address names
// (?fixture=twentyPage) as every page, so each condition opens Lectures, then Membranes.

import type { Locator, Page } from '@playwright/test';
import type { PageFixtureName } from '../../../app/src/services/pages/fixtures';

export type Caret = 'start' | 'middle' | 'end';

export interface Condition {
  readonly id: string;
  readonly description: string;
  readonly fixture: PageFixtureName;
  /** Milliseconds between keys. Default 120, as ADR 0005's harness sends them. */
  readonly gapMs?: number;
  /** Starts the browser with its accessibility tree on, as a UI Automation client such as Narrator does. */
  readonly accessibility?: boolean;
  /** Puts the caret where typing goes, after the page is open. */
  prepare(page: Page): Promise<void>;
}

/** Opens the page fixture's copy of Membranes and waits for its text. */
export async function openFixture(page: Page, fixture: PageFixtureName): Promise<void> {
  await page.goto(`/?fixture=${fixture}`);
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await page
    .getByRole('textbox', { name: /^(Page text|Text box 1)/ })
    .first()
    .waitFor();
}

/** The longest text box on the page: the 20-page note on every 20-page fixture. */
async function longestBox(page: Page): Promise<Locator> {
  const index = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[role="textbox"][contenteditable]')];
    const lengths = boxes.map((box) => box.textContent?.length ?? 0);
    return lengths.indexOf(Math.max(...lengths));
  });
  return page.locator('[role="textbox"][contenteditable]').nth(index);
}

const frame = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));

/**
 * Focuses a text box and puts the caret at its start, middle, or end, after a space for the middle so typing
 * makes a new word. The editor reads the DOM selection, as it does after a click.
 */
export async function placeCaret(page: Page, box: Locator, caret: Caret): Promise<void> {
  await box.click({ position: { x: 8, y: 8 } });
  await box.evaluate((root, caret) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    let node = nodes[0];
    let offset = 0;
    if (caret === 'end') {
      node = nodes[nodes.length - 1];
      offset = node.length;
    } else if (caret === 'middle') {
      const total = nodes.reduce((sum, text) => sum + text.length, 0);
      let left = total / 2;
      for (const text of nodes) {
        node = text;
        if (left < text.length) break;
        left -= text.length;
      }
      const space = node.data.indexOf(' ', Math.floor(left));
      offset = space < 0 ? node.length : space + 1;
    }
    (root as HTMLElement).focus();
    getSelection()!.collapse(node, offset);
    node.parentElement!.scrollIntoView({ block: 'center' });
  }, caret);
  await frame(page);
  await frame(page);
}

/** Puts the caret at the end of the 20-page note and adds a block there by typing, then waits for it. */
async function atEndOfNote(page: Page): Promise<void> {
  await placeCaret(page, await longestBox(page), 'end');
  await page.keyboard.press('Enter');
}

/** Presses page zoom keys until the page's scale passes `target`. */
async function zoomTo(page: Page, target: number): Promise<void> {
  const scale = () =>
    page.evaluate(() => {
      const world = document.querySelector<HTMLElement>('h1[data-page-title]')!.parentElement!.parentElement!;
      return world.getBoundingClientRect().width / world.offsetWidth;
    });
  const key = target < 1 ? 'Control+Alt+Minus' : 'Control+Alt+Equal';
  for (let i = 0; i < 12; i += 1) {
    const now = await scale();
    if (target < 1 ? now <= target + 0.001 : now >= target - 0.001) return;
    await page.keyboard.press(key);
    await frame(page);
  }
  throw new Error(`Page zoom stopped short of ${target * 100}%.`);
}

const inNote = (caret: Caret) => async (page: Page) => placeCaret(page, await longestBox(page), caret);

export const CONDITIONS: readonly Condition[] = [
  { id: 'short', description: 'A short note (control)', fixture: 'short', prepare: inNote('end') },
  {
    id: 'flat.start',
    description: '20-page note, caret at the start',
    fixture: 'twentyPage',
    prepare: inNote('start'),
  },
  {
    id: 'flat.middle',
    description: '20-page note, caret in the middle',
    fixture: 'twentyPage',
    prepare: inNote('middle'),
  },
  { id: 'flat.end', description: '20-page note, caret at the end', fixture: 'twentyPage', prepare: inNote('end') },
  {
    id: 'outline',
    description: '20-page outline (about 1,200 items, 4 levels), middle',
    fixture: 'twentyPageOutline',
    prepare: inNote('middle'),
  },
  {
    id: 'callout',
    description: '20-page note inside one callout, middle',
    fixture: 'twentyPageCallout',
    prepare: inNote('middle'),
  },
  {
    id: 'freeform',
    description: 'Freeform page with 8 text boxes, in the 20-page box',
    fixture: 'freeform8',
    prepare: inNote('middle'),
  },
  {
    id: 'table',
    description: 'A table cell after the 20-page note',
    fixture: 'twentyPage',
    prepare: async (page) => {
      await atEndOfNote(page);
      await page.keyboard.type('/table');
      await page.getByRole('listbox').waitFor();
      await page.keyboard.press('Enter');
      const cell = page.getByRole('group', { name: 'Table' }).locator('[contenteditable="true"]').first();
      await cell.waitFor();
      await page.keyboard.type('x');
    },
  },
  {
    id: 'code',
    description: 'A highlighted TypeScript code block after the 20-page note',
    fixture: 'twentyPage',
    prepare: async (page) => {
      await atEndOfNote(page);
      await page.keyboard.type('```ts ');
      await page.locator('pre code').last().waitFor({ state: 'attached' });
      await page.keyboard.type('const value = compute(1, 2);');
      await page.keyboard.press('Enter');
    },
  },
  {
    id: 'spelling',
    description: '20-page note with spell check on and 200 errors in view',
    fixture: 'twentyPage',
    prepare: async (page) => {
      await placeCaret(page, await longestBox(page), 'middle');
      // 40 short paragraphs with 5 misspellings each, pasted as plain text where the caret is: a screenful.
      await page.evaluate(() => {
        const words = ['teh', 'recieve', 'wich', 'untill'];
        const paragraphs = Array.from({ length: 40 }, (_, p) =>
          Array.from({ length: 5 }, (_, i) => `a ${words[(p + i) % 4]} word`).join(' '),
        );
        const data = new DataTransfer();
        data.setData('text/plain', paragraphs.join('\n\n'));
        const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
        document.activeElement!.dispatchEvent(paste);
      });
      // Squiggles come after typing pauses for 500 ms.
      await page.waitForFunction(() => (CSS.highlights.get('spelling-error')?.size ?? 0) >= 200, null, {
        timeout: 10_000,
      });
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('End');
      await page.keyboard.press('Space');
    },
  },
  {
    id: 'burst',
    description: '20-page note, bursts of 30 keys a second',
    fixture: 'twentyPage',
    gapMs: 33,
    prepare: inNote('middle'),
  },
  {
    id: 'screenReader',
    description: '20-page note, screen reader on and the accessibility tree built',
    fixture: 'twentyPage',
    accessibility: true,
    prepare: async (page) => {
      await page.evaluate(() =>
        (window as unknown as { __OPENNOTE_TEST__: { setOs(os: object): void } }).__OPENNOTE_TEST__.setOs({
          screenReader: true,
        }),
      );
      await placeCaret(page, await longestBox(page), 'middle');
    },
  },
  {
    id: 'zoom50',
    description: '20-page note at 50% page zoom',
    fixture: 'twentyPage',
    prepare: async (page) => {
      await placeCaret(page, await longestBox(page), 'middle');
      await zoomTo(page, 0.5);
    },
  },
  {
    id: 'zoom200',
    description: '20-page note at 200% page zoom',
    fixture: 'twentyPage',
    prepare: async (page) => {
      await placeCaret(page, await longestBox(page), 'middle');
      await zoomTo(page, 2);
    },
  },
];
