// The pictures added for the feature list: study, the tutor, the daily calendar, diagrams, mind maps, ink layers,
// groups, and links, PDF import, translate, protected sections, sync, and the tool kits.
import { expect, type Page } from '@playwright/test';
import { choose, draw, ellipse, line } from '../ink';
import { insertPdf } from '../pdf';

export interface Scene {
  name: string;
  fixture?: string;
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

  async function lassoed(p: Page) {
    await openMembranes(p);
    await p.getByRole('tab', { name: 'Draw' }).click();
    await choose(p, 'Pen, Ink, 0.5 mm');
    await draw(p, line([150, 350], [260, 360]));
    await draw(p, line([420, 350], [530, 360]));
    await choose(p, 'Lasso select');
    await draw(p, ellipse(340, 355, 240, 70));
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
        await expect(p.getByRole('dialog', { name: 'Flashcards' }).getByText(/3 cards/)).toBeVisible();
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
        await h.command(p, 'daily notes calendar', /daily notes calendar/);
        await p.waitForTimeout(500);
      },
    },
    {
      name: 'insert-mind-map',
      fixture: 'smart',
      run: async (p) => {
        await openMembranes(p);
        await h.command(p, 'Insert mind map', 'Insert mind map');
        await p.getByRole('button', { name: 'Add branch under' }).click();
        await p.getByRole('button', { name: 'Add branch beside' }).click();
        await p.getByRole('button', { name: 'Add branch under' }).click();
        await p.waitForTimeout(800);
      },
    },
    {
      name: 'insert-diagram',
      fixture: 'smart',
      run: async (p) => {
        await openMembranes(p);
        await h.command(p, 'Insert diagram', /^Insert diagram/);
        await p.waitForTimeout(800);
      },
    },
    {
      name: 'ink-layers',
      fixture: 'smart',
      viewport: { width: 1600, height: 900 },
      run: async (p) => {
        await openMembranes(p);
        await p.getByRole('tab', { name: 'Draw' }).click();
        await choose(p, 'Pen, Ink, 0.5 mm');
        await draw(p, line([150, 350], [400, 350]));
        await h.command(p, 'layers', /^Layers/);
        const d = p.getByRole('dialog', { name: 'Layers' });
        await d.getByRole('button', { name: 'Add a layer' }).click();
        await d.getByRole('button', { name: 'Add a layer' }).click();
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
        await openMembranes(p);
        await p.getByRole('tab', { name: 'Draw' }).click();
        await choose(p, 'Pen, Ink, 0.5 mm');
        await draw(p, line([150, 350], [400, 380]));
        await choose(p, 'Lasso select');
        await draw(p, ellipse(275, 365, 220, 90));
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
        await insertPdf(p, 'lecture.pdf', ['Cell walls', 'Osmosis']);
        await expect(p.getByRole('group', { name: /Page 2 of 2 from lecture\.pdf/ })).toBeVisible();
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
      run: async (p) => {
        await h.typeNotes(p);
        await h.command(p, 'beam', /beam/i);
        await p.waitForTimeout(800);
      },
    },
    {
      name: 'subject-statistics',
      run: async (p) => {
        await h.typeNotes(p);
        await h.command(p, 'statistics', /statistic/i);
        await p.getByRole('textbox', { name: 'Data' }).fill('2, 4, 4, 5, 7, 9');
        await p.getByRole('button', { name: 'Calculate' }).click();
        await p.waitForTimeout(800);
      },
    },
  ];
}
