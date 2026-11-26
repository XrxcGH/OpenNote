// The pictures added for the feature list: study, the tutor, the daily calendar, diagrams, mind maps, ink layers,
// groups, and links, PDF import, translate, protected sections, sync, and the tool kits.
import { expect, type Page } from '@playwright/test';
import { choose, draw, ellipse } from '../ink';
import { HANDOUT, lecturePdf } from './lecturePdf';

export interface Scene {
  name: string;
  fixture?: string;
  /** Where the app opens, such as `/?searchExtras`. */
  path?: string;
  viewport?: { width: number; height: number };
  /** Skip the wait for pictures to settle: a page of PDF pictures never reports settled. */
  quick?: boolean;
  run(page: Page): Promise<void>;
}

/** The helpers of capture.spec.ts, handed in so the two files share them. */
export interface Helpers {
  ready(p: Page): Promise<void>;
  command(p: Page, query: string, option: string | RegExp): Promise<void>;
  settings(p: Page, section: string): Promise<void>;
  typeNotes(p: Page): Promise<void>;
  /** Opens a page of the fixture: the section, then the page title. */
  openPage(p: Page, section: string, title: string): Promise<void>;
  /** Types lines into the page, pressing Enter between them; waits until `saved` is held when given. */
  write(p: Page, lines: string[], saved?: string): Promise<void>;
  /** Clicks a command bar tab and waits for the page to settle. */
  tab(p: Page, name: string): Promise<void>;
}

// checks-disable-next-line modifiability: one list of capture scenes that share their helpers; split it when it grows again
export function scenes(h: Helpers): Scene[] {
  const notebooks = (p: Page) => p.getByRole('tree', { name: 'Notebooks' });
  const pagesTree = (p: Page) => p.getByRole('tree', { name: 'Pages' });
  const textBox = (p: Page) => p.getByRole('textbox', { name: 'Text' }).first();

  /** The smart-notes sampler page (fixture `smart`), open. */
  async function openMembranes(p: Page) {
    await h.ready(p);
    await notebooks(p).getByRole('treeitem', { name: 'Lectures' }).click();
    await pagesTree(p).getByRole('treeitem', { name: 'Membranes' }).click();
    await expect(p.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
    await p.getByRole('tab', { name: 'Draw' }).waitFor({ timeout: 20_000 });
  }

  async function typeLines(p: Page, lines: string[]) {
    await textBox(p).click();
    for (const [i, text] of lines.entries()) {
      if (i > 0) await p.keyboard.press('Enter');
      await p.keyboard.type(text);
    }
  }

  const wavy = (x0: number, y: number, w: number, cycles: number): [number, number][] =>
    Array.from({ length: 41 }, (_, i) => [x0 + (w * i) / 40, y + 9 * Math.sin((i / 40) * cycles * 6.2832)]);

  /** A page of notes with two handwritten lines under them. */
  async function inked(p: Page) {
    await openMembranes(p);
    await typeLines(p, ['## Cell membranes', 'The membrane is a double layer of phospholipids.']);
    await p.getByRole('tab', { name: 'Draw' }).click();
    await choose(p, 'Pen, Ink, 0.5 mm');
    await draw(p, wavy(150, 350, 230, 5));
    await draw(p, wavy(420, 350, 230, 6));
  }

  async function lassoed(p: Page) {
    await inked(p);
    await choose(p, 'Lasso select');
    await draw(p, ellipse(400, 355, 340, 70));
    const bar = p.getByRole('toolbar', { name: 'Selected ink and text' });
    await bar.waitFor();
    return bar;
  }

  return [
    {
      name: 'study-flashcards',
      fixture: 'smart',
      run: async (p) => {
        await openMembranes(p);
        await typeLines(p, [
          'Largest planet :: Jupiter',
          'The {{heart}} pumps blood',
          'Boiling point of water :: 100 C',
        ]);
        await p.waitForTimeout(2500);
        await h.command(p, 'Open flashcards', 'Open flashcards');
        const decks = p.getByRole('dialog', { name: 'Flashcards' });
        await expect(decks.getByText(/3 cards/)).toBeVisible();
        // The deck made from the page's lines has no name of its own yet, so give it one, as a person would.
        await decks.locator('li button').first().click();
        await decks.getByRole('button', { name: 'Rename deck' }).click();
        await decks.getByRole('textbox', { name: 'Deck name' }).fill('Quick facts');
        await p.keyboard.press('Enter');
        await decks.getByRole('button', { name: 'Back to decks' }).click();
        await expect(decks.getByRole('button', { name: 'Quick facts' })).toBeVisible();
      },
    },
    {
      name: 'study-tutor',
      fixture: 'smart',
      run: async (p) => {
        await openMembranes(p);
        await typeLines(p, ['2x + 3 = 7', '2x = 10', 'x = 5']);
        await p.keyboard.press('Shift+ArrowUp');
        await p.keyboard.press('Shift+ArrowUp');
        await p.keyboard.press('Shift+Home');
        await textBox(p)
          .locator('p')
          .filter({ hasText: /^2x = 10$/ })
          .click({ button: 'right' });
        await p.getByRole('menuitem', { name: 'Give me a hint' }).click();
        const ask = p.getByRole('dialog', { name: 'Turn on the tutor?' });
        await ask.waitFor({ timeout: 15_000 });
        await ask.getByRole('button', { name: 'Turn on' }).click();
        await p.waitForTimeout(1500);
      },
    },
    {
      name: 'daily-calendar',
      run: async (p) => {
        await h.typeNotes(p);
        await p.getByRole('button', { name: "Open today's note" }).click();
        await expect(p.getByRole('heading', { level: 1, name: '2026-09-30' })).toBeVisible();
        for (const day of ['Tuesday, September 29, 2026', 'Monday, September 28, 2026']) {
          await h.command(p, 'daily notes calendar', /daily notes calendar/);
          await p.getByRole('dialog', { name: 'Daily notes' }).getByRole('button', { name: day }).click();
          await p.waitForTimeout(500);
        }
        await h.command(p, 'daily notes calendar', /daily notes calendar/);
        await p.getByRole('dialog', { name: 'Daily notes' }).waitFor();
        await p.waitForTimeout(500);
      },
    },
    {
      name: 'insert-mind-map',
      fixture: 'smart',
      run: async (p) => {
        await openMembranes(p);
        await typeLines(p, ['## Cell membranes', 'A mind map of what the membrane does and is made of.', '']);
        await h.command(p, 'Insert mind map', 'Insert mind map');
        await p.getByText('Main idea').first().click();
        await p.keyboard.press('Enter');
        await p.keyboard.press('Control+a');
        await p.keyboard.type('Cell membrane');
        await p.keyboard.press('Tab');
        await p.keyboard.type('Structure');
        await p.keyboard.press('Enter');
        await p.keyboard.type('Transport');
        await p.keyboard.press('Enter');
        await p.keyboard.type('Signaling');
        await p.keyboard.press('Tab');
        await p.keyboard.type('Receptor proteins');
        await p.keyboard.press('Enter');
        await p.keyboard.type('Hormones');
        await p.keyboard.press('Escape');
        await p.waitForTimeout(800);
      },
    },
    {
      name: 'insert-diagram',
      fixture: 'smart',
      run: async (p) => {
        await openMembranes(p);
        await typeLines(p, ['## Photosynthesis', 'The light reaction feeds the Calvin cycle.', '']);
        await h.command(p, 'Insert diagram', /^Insert diagram/);
        await p
          .getByRole('textbox', { name: 'Diagram text' })
          .fill(
            'flowchart LR\n  A[Sunlight] --> B[Light reaction]\n  B --> C[ATP and NADPH]\n  C --> D[Calvin cycle]\n  D --> E[Glucose]',
          );
        await p
          .getByRole('textbox', { name: 'Description of the diagram' })
          .fill('Flowchart of photosynthesis, from sunlight to glucose');
        await expect(p.getByText('Glucose').last()).toBeVisible({ timeout: 20_000 });
        await p.waitForTimeout(800);
      },
    },
    {
      name: 'ink-layers',
      fixture: 'smart',
      viewport: { width: 1600, height: 900 },
      run: async (p) => {
        await inked(p);
        await h.command(p, 'layers', /^Layers/);
        const d = p.getByRole('dialog', { name: 'Layers' });
        await d.getByRole('button', { name: 'Add a layer' }).click();
        await d.getByRole('button', { name: 'Add a layer' }).click();
        await d.getByRole('textbox', { name: 'Name of Layer 3' }).fill('Labels');
        await d.getByRole('textbox', { name: 'Name of Layer 2' }).fill('Diagram');
        await d.getByRole('textbox', { name: 'Name of Layer 1' }).fill('Notes');
      },
    },
    {
      name: 'ink-groups',
      fixture: 'smart',
      viewport: { width: 1600, height: 900 },
      run: async (p) => {
        const bar = await lassoed(p);
        await bar.getByRole('button', { name: 'Group', exact: true }).click();
        await expect(bar.getByRole('button', { name: 'Ungroup' })).toBeVisible();
      },
    },
    {
      name: 'ink-links',
      fixture: 'smart',
      viewport: { width: 1600, height: 900 },
      run: async (p) => {
        await inked(p);
        await choose(p, 'Lasso select');
        await draw(p, ellipse(275, 355, 190, 60));
        const bar = p.getByRole('toolbar', { name: 'Selected ink and text' });
        await bar.getByRole('button', { name: 'Make link' }).click();
        const d = p.getByRole('dialog', { name: 'Make link' });
        await d.getByRole('radio', { name: 'A web address' }).click();
        await d.getByRole('textbox', { name: 'Web address' }).fill('https://example.com/notes');
        await d.getByRole('button', { name: 'Make link' }).click();
        await p.keyboard.press('Escape');
        await h.command(p, 'links on this page', /Links on this page/);
        await p.getByRole('dialog', { name: 'Links on this page' }).getByRole('listitem').first().waitFor();
      },
    },
    {
      name: 'pdf-import',
      fixture: 'smart',
      quick: true,
      run: async (p) => {
        await openMembranes(p);
        const chooser = p.waitForEvent('filechooser');
        await h.command(p, 'Insert PDF', 'Insert PDF');
        await (
          await chooser
        ).setFiles({ name: 'lecture.pdf', mimeType: 'application/pdf', buffer: lecturePdf(HANDOUT) });
        await expect(p.getByRole('group', { name: /Page 2 of 2 from lecture\.pdf/ })).toBeVisible({ timeout: 30_000 });
        // Let the page pictures finish drawing, then take the toast away so only the pages show.
        await p.waitForTimeout(3000);
        const close = p.locator('button', { hasText: /^Close$/ });
        if (await close.count()) await close.first().click();
        // Scroll a little past the top of the first page, so its Original button is not under the Properties pill.
        await p.getByRole('group', { name: /Page 1 of 2 from lecture\.pdf/ }).evaluate((e) => {
          e.scrollIntoView({ block: 'start' });
          let scroller = e.parentElement;
          while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
          if (scroller) scroller.scrollTop += 90;
        });
        await p.waitForTimeout(500);
      },
    },
    {
      name: 'translate',
      fixture: 'smart',
      run: async (p) => {
        await openMembranes(p);
        await typeLines(p, ['Cells make energy.']);
        await h.command(p, 'Translate', 'Translate');
        const d = p.getByRole('dialog', { name: 'Translate on this device' });
        await d.getByLabel('Translate to').selectOption('es');
        await expect(d).toContainText('English to Spanish');
      },
    },
    {
      name: 'protected-section',
      run: async (p) => {
        await h.ready(p);
        const lectures = notebooks(p).getByRole('treeitem', { name: /Lectures/ });
        await lectures.click();
        await lectures.click({ button: 'right' });
        await p.getByRole('menuitem', { name: 'Protect with password…' }).click();
        const d = p.getByRole('dialog', { name: /Protect .Lectures. with a password/ });
        await d.getByLabel('Password', { exact: true }).fill('river stone 42');
        await d.getByLabel('Type the password again').fill('river stone 42');
        await d.getByRole('button', { name: 'Protect' }).click();
        await expect(p.getByText('This section is locked.')).toBeVisible();
      },
    },
    {
      name: 'sync-settings',
      run: async (p) => {
        await h.settings(p, 'Sync');
        await p.getByRole('button', { name: 'Set up sync' }).click();
        await p.getByLabel('Folder', { exact: true }).fill('D:\\Backups\\OpenNote Sync');
      },
    },
    {
      name: 'engineering-beam',
      // Tall enough for the supports, the loads, the results, and the deflection curve together.
      viewport: { width: 1280, height: 1700 },
      run: async (p) => {
        await h.typeNotes(p);
        await h.command(p, 'beam', /beam/i);
        const d = p.getByRole('dialog', { name: 'Solid mechanics', exact: true });
        await d.waitFor({ timeout: 20_000 });
        await p.waitForTimeout(1500);
        // Scroll to the supports and the loads, so the beam's setup shows with the results and the curve below it.
        await d
          .getByText('Supports, one to a line', { exact: true })
          .first()
          .evaluate((e) => e.scrollIntoView({ block: 'start' }));
        await p.waitForTimeout(800);
      },
    },
    {
      name: 'subject-statistics',
      run: async (p) => {
        await h.typeNotes(p);
        await h.command(p, 'statistics', /statistic/i);
        // Widen the window until every tab of the calculator shows.
        await p.getByRole('separator', { name: /^Resize Calculator/ }).focus();
        for (let i = 0; i < 22; i += 1) await p.keyboard.press('ArrowLeft');
        await p.getByRole('dialog', { name: 'Calculator' }).getByRole('heading', { name: 'Calculator' }).click();
        await p.getByRole('textbox', { name: 'Data' }).fill('2, 4, 4, 5, 7, 9');
        await p.getByRole('button', { name: 'Calculate' }).click();
        await p.waitForTimeout(800);
      },
    },
  ];
}
