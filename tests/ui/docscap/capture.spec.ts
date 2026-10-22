// Temporary: documentation screenshot capture. Not committed.
import { expect, test, type Page } from '@playwright/test';
import { settle } from '../screens';

const RAW =
  'C:/Users/ericj/AppData/Local/Temp/claude/C--Users-ericj-GitHub-OpenNote/05b4a35e-76de-4076-bd7f-c37a5fb1fabe/scratchpad/raw';
const THEMES = ['light', 'dark'] as const;

interface Shot {
  name: string;
  fixture?: string;
  path?: string;
  boot?: Record<string, unknown>;
  viewport?: { width: number; height: number };
  run(page: Page): Promise<void>;
}

const firstRun = { firstRun: true, state: { setup: { status: 'notStarted' } } };
const notebooks = (p: Page) => p.getByRole('tree', { name: 'Notebooks' });
const pagesTree = (p: Page) => p.getByRole('tree', { name: 'Pages' });
const textBox = (p: Page) => p.getByRole('textbox', { name: 'Text' }).first();

const ready = async (p: Page) => {
  await p.locator('[data-workspace]').waitFor();
  await p.evaluate(() => new Promise<void>((d) => requestAnimationFrame(() => requestAnimationFrame(() => d()))));
};

async function openPage(p: Page, section: string, title: string) {
  await ready(p);
  await notebooks(p).getByRole('treeitem', { name: section }).click();
  await pagesTree(p).getByRole('treeitem', { name: title }).click();
  await expect(p.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await p.getByRole('tab', { name: 'Draw' }).waitFor({ timeout: 20_000 });
}

const held = (p: Page) => () =>
  p.evaluate(() => JSON.stringify((window as never as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__.pagesHeld()));

async function write(p: Page, lines: string[], saved?: string) {
  const box = textBox(p);
  await box.click();
  await expect(box).toHaveAttribute('contenteditable', 'true');
  for (const [i, line] of lines.entries()) {
    await p.keyboard.type(line);
    if (i < lines.length - 1) await p.keyboard.press('Enter');
  }
  if (saved) await expect.poll(held(p)).toContain(saved);
}

const MITOSIS = [
  '## Phases of mitosis',
  'A cell divides in four steps, and each one has a job.',
  '- Prophase: the chromosomes coil up and the nuclear envelope breaks down',
  'Metaphase: the chromosomes line up along the middle of the cell',
  'Anaphase: the sister chromatids pull apart',
  'Telophase: two new nuclei form',
  '',
  'Question for Thursday: how does this differ from [[Meiosis]]?',
];

async function typeNotes(p: Page, saved = 'Question for Thursday') {
  await openPage(p, 'Lectures', 'Mitosis');
  await write(p, MITOSIS, saved);
}

async function tab(p: Page, name: string) {
  await p.getByRole('tab', { name }).click();
  await settle(p);
}

async function hidePagesPane(p: Page) {
  await tab(p, 'View');
  await p.getByRole('toolbar').getByRole('button', { name: 'Pages pane', exact: true }).click();
  await tab(p, 'Home');
}

async function scrollTop(p: Page) {
  await p.getByRole('heading', { level: 1, name: 'Membranes' }).evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await settle(p);
}

async function openSmart(p: Page) {
  await openPage(p, 'Lectures', 'Membranes');
  await expect(p.locator('table')).toBeVisible({ timeout: 20_000 });
}

async function setCell(p: Page, row: number, column: number, text: string) {
  const cell = p.locator('table tr').nth(row).locator('td, th').nth(column);
  await cell.click();
  await p.keyboard.press('End');
  await p.keyboard.press('Shift+Home');
  await p.keyboard.type(text);
}

async function newLine(p: Page) {
  const box = textBox(p);
  await box.click();
  await expect(box).toHaveAttribute('contenteditable', 'true');
  await p.keyboard.press('Control+End');
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
}

async function settings(p: Page, section: string) {
  await ready(p);
  await p.keyboard.press('Control+Comma');
  const nav = p.getByRole('navigation', { name: 'Settings sections' });
  await nav.waitFor();
  const link = nav.getByRole('link', { name: section, exact: true });
  await link.click();
  await expect(p.getByRole('heading', { level: 1, name: section, exact: true })).toBeVisible();
  await p.waitForTimeout(900);
}

async function command(p: Page, query: string, option: string | RegExp) {
  await p.keyboard.press('Control+KeyK');
  const box = p.getByRole('combobox', { name: 'Search commands and pages' });
  await box.waitFor();
  await box.pressSequentially(query, { delay: 10 });
  await p.getByRole('option', { name: option }).first().click();
}

const SHOTS: Shot[] = [
  ...[
    ['setup-welcome', 'Welcome to OpenNote'],
    ['setup-look', 'Choose your look'],
    ['setup-language', 'Language and spelling'],
    ['setup-intelligence', 'On-device intelligence'],
    ['setup-keys-and-pen', 'Keys and pen'],
    ['setup-storage', 'Where to keep things'],
    ['setup-import', 'Bring in your notes'],
  ].map(
    ([name, heading], step): Shot => ({
      name,
      boot: firstRun,
      run: async (p) => {
        for (let i = 0; i < step; i += 1)
          await p.getByRole('button', { name: i === 0 ? 'Get started' : 'Continue' }).click();
        await p.getByRole('heading', { level: 1, name: heading }).waitFor();
      },
    }),
  ),
  {
    name: 'workspace',
    run: async (p) => {
      await typeNotes(p);
      await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    },
  },
  { name: 'workspace-empty', fixture: 'empty', run: ready },
  {
    name: 'tab-home',
    run: async (p) => {
      await typeNotes(p);
      await tab(p, 'Home');
      for (let i = 0; i < 4; i += 1) {
        if (await p.getByRole('toolbar').getByRole('button', { name: 'Bold', exact: true }).isVisible()) break;
        await tab(p, 'Insert');
        await tab(p, 'Home');
      }
      await expect(p.getByRole('toolbar').getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
    },
  },
  {
    name: 'tab-insert',
    run: async (p) => {
      await typeNotes(p);
      await tab(p, 'Insert');
    },
  },
  {
    name: 'tab-draw',
    viewport: { width: 1600, height: 900 },
    run: async (p) => {
      await typeNotes(p);
      await tab(p, 'Draw');
    },
  },
  {
    name: 'tab-view',
    run: async (p) => {
      await typeNotes(p);
      await tab(p, 'View');
    },
  },
  {
    name: 'ink',
    viewport: { width: 1600, height: 900 },
    run: async (p) => {
      await typeNotes(p);
      await tab(p, 'Draw');
      const overlay = p.locator('[data-ink-overlay]');
      await overlay.waitFor({ state: 'attached' });
      const box = (await overlay.boundingBox())!;
      const stroke = async (pts: [number, number][]) => {
        await p.mouse.move(box.x + pts[0][0], box.y + pts[0][1]);
        await p.mouse.down();
        for (const [x, y] of pts.slice(1)) await p.mouse.move(box.x + x, box.y + y, { steps: 3 });
        await p.mouse.up();
      };
      const oval = (cx: number, cy: number, rx: number, ry: number, turns = 1.08): [number, number][] =>
        Array.from({ length: 49 }, (_, i) => [
          cx + rx * Math.cos((i / 48) * turns * 6.2832 - 1.6),
          cy + ry * Math.sin((i / 48) * turns * 6.2832 - 1.6),
        ]);
      const wavy = (x0: number, y: number, w: number, amp: number, cycles: number): [number, number][] =>
        Array.from({ length: 41 }, (_, i) => [x0 + (w * i) / 40, y + amp * Math.sin((i / 40) * cycles * 6.2832)]);
      const toolbar = p.getByRole('toolbar', { name: 'Draw' });
      const pick = async (name: RegExp) => {
        await toolbar.getByRole('button', { name }).first().click();
      };
      const link = p.getByText('[[Meiosis]]').first();
      const lb = (await link.boundingBox())!;
      const cx = lb.x + lb.width / 2 - box.x;
      const cy = lb.y + lb.height / 2 - box.y;
      const heading = (await p.getByRole('heading', { name: 'Phases of mitosis' }).boundingBox())!;
      await pick(/^Highlighter, /);
      await stroke([
        [heading.x - box.x - 4, heading.y - box.y + heading.height / 2 + 2],
        [heading.x - box.x + heading.width + 6, heading.y - box.y + heading.height / 2 + 2],
      ]);
      await pick(/^Pen, Indigo/);
      await stroke(oval(cx, cy, lb.width / 2 + 14, 20));
      await pick(/^Pen, Fern/);
      await stroke([[cx - 50, cy + 26], [cx - 120, cy + 70], [cx - 200, cy + 105]]);
      await stroke([[cx - 200, cy + 105], [cx - 178, cy + 82]]);
      await stroke([[cx - 200, cy + 105], [cx - 168, cy + 108]]);
      await pick(/^Pencil, /);
      await stroke(oval(cx - 330, cy + 190, 90, 62));
      await stroke(wavy(cx - 390, cy + 190, 120, 14, 2));
      await stroke([[cx - 330, cy + 130], [cx - 330, cy + 250]]);
      await pick(/^Pen, Ink/);
      await stroke(wavy(cx - 230, cy + 175, 230, 9, 5));
      await settle(p);
    },
  },
  {
    name: 'ruled',
    run: async (p) => {
      await typeNotes(p);
      await tab(p, 'View');
      await p.getByRole('toolbar').getByRole('button', { name: 'Background' }).click();
      await p.getByRole('menuitemradio', { name: 'Lined, college' }).click();
      await expect(p.locator('[data-ruled]')).toHaveCount(1);
    },
  },
  {
    name: 'table-chart',
    path: '/?fixture=smart',
    run: async (p) => {
      await openSmart(p);
      await hidePagesPane(p);
      const rows = [
        ['Month', 'Sales', 'Cost'],
        ['Jan', '120', '80'],
        ['Feb', '150', '=B2*0.6'],
        ['Mar', '90', '70'],
      ];
      for (const [r, row] of rows.entries()) for (const [c, text] of row.entries()) await setCell(p, r, c, text);
      await p.locator('table tr').nth(1).locator('td').first().click();
      await p.getByRole('button', { name: 'Data' }).click();
      await p.getByRole('menuitem', { name: 'Insert chart' }).click();
      await p.getByRole('menuitem', { name: 'Bar chart' }).click();
      await expect(p.getByRole('img', { name: /^Bar chart/ }).locator('svg')).toBeVisible();
      await p.locator('table tr').first().locator('th').first().click();
      await p.locator('table').first().evaluate((e) => e.scrollIntoView({ block: 'start' }));
      await settle(p);
    },
  },
  {
    name: 'math-graph',
    path: '/?fixture=smart',
    run: async (p) => {
      await openSmart(p);
      await hidePagesPane(p);
      await newLine(p);
      await p.keyboard.type('The area under the parabola from 0 to 1 is ');
      await p.keyboard.press('Alt+=');
      await p.getByRole('textbox', { name: 'Math source' }).waitFor();
      await p.keyboard.insertText(String.raw`\int_0^1 x^2\,dx = \frac13`);
      await p.keyboard.press('Enter');
      await expect(p.getByRole('math').first().locator('.katex')).toBeVisible();
      await p.keyboard.type('.');
      await newLine(p);
      await p.keyboard.type('/graph');
      await p.getByRole('option', { name: 'Insert graph' }).waitFor();
      await p.keyboard.press('Enter');
      await expect(p.getByRole('application', { name: /^Graph of/ })).toBeVisible({ timeout: 20_000 });
      await scrollTop(p);
    },
  },
  {
    name: 'search',
    run: async (p) => {
      await typeNotes(p);
      await p.keyboard.press('Control+Shift+KeyF');
      const box = p.getByRole('combobox', { name: 'Search notes' });
      await box.fill('chromosomes');
      await p.locator('strong', { hasText: 'chromosomes' }).first().waitFor();
    },
  },
  {
    name: 'backlinks',
    run: async (p) => {
      await openPage(p, 'Lectures', 'Mitosis');
      await write(p, ['Question: how does this differ from [[Meiosis]]?', 'See also [[Membranes]].'], 'Membranes');
      await openPage(p, 'Lectures', 'Meiosis');
      await p.keyboard.press('Control+Alt+KeyG');
      await p.getByRole('region', { name: 'Linked pages' }).waitFor();
    },
  },
  {
    name: 'recording',
    run: async (p) => {
      await typeNotes(p);
      await tab(p, 'Home');
      await p.getByRole('group', { name: 'Recording', exact: true }).getByRole('button', { name: 'Options' }).click();
    },
  },
  {
    name: 'import',
    run: async (p) => {
      await typeNotes(p);
      await command(p, 'import notes', /Import notes/);
      await p.getByRole('dialog', { name: 'Import notes' }).waitFor();
    },
  },
  {
    name: 'import-review',
    run: async (p) => {
      await typeNotes(p);
      await command(p, 'import notes', /Import notes/);
      const dialog = p.getByRole('dialog', { name: 'Import notes' });
      await dialog.getByRole('button', { name: /^Choose a file/ }).click();
      await dialog.getByRole('heading', { name: /pages will come into a new notebook/ }).waitFor();
    },
  },
  {
    name: 'export',
    run: async (p) => {
      await typeNotes(p);
      await notebooks(p).getByRole('treeitem', { name: 'Lectures' }).click({ button: 'right' });
      await p.getByRole('menuitem', { name: /^Export/ }).click();
      const dialog = p.getByRole('dialog', { name: /^Export "Lectures"/ });
      await dialog.waitFor();
      await dialog.getByRole('radio', { name: /Word document/ }).click();
      await dialog.evaluate((e) => {
        for (const el of [e, ...e.querySelectorAll('*')]) if (el.scrollTop) el.scrollTop = 0;
      });
    },
  },
  { name: 'settings-general', run: (p) => settings(p, 'General') },
  { name: 'settings-appearance', run: (p) => settings(p, 'Appearance') },
  { name: 'settings-editing', run: (p) => settings(p, 'Editing') },
  { name: 'settings-intelligence', run: (p) => settings(p, 'On-device intelligence') },
  { name: 'settings-privacy', run: (p) => settings(p, 'Privacy') },
  { name: 'settings-connectors', run: (p) => settings(p, 'Connectors') },
  { name: 'settings-shortcuts', run: (p) => settings(p, 'Shortcuts') },
  { name: 'settings-about', run: (p) => settings(p, 'About') },
  {
    name: 'trash',
    run: async (p) => {
      await ready(p);
      await notebooks(p).getByRole('treeitem', { name: 'Lectures' }).click();
      for (const title of ['Mitosis', 'Meiosis']) {
        await pagesTree(p).getByRole('treeitem', { name: title }).focus();
        await p.keyboard.press('Delete');
      }
      await p.getByRole('button', { name: 'Trash' }).click();
      await p.getByRole('listitem').filter({ hasText: 'Mitosis' }).waitFor();
      const toastClose = p.locator('button', { hasText: /^Close$/ });
      while (await toastClose.count()) await toastClose.first().click();
      await expect(p.getByText(/^Moved /)).toHaveCount(0);
    },
  },
  {
    name: 'palette',
    run: async (p) => {
      await typeNotes(p);
      await p.keyboard.press('Control+KeyK');
      await p.getByRole('combobox', { name: 'Search commands and pages' }).waitFor();
    },
  },
  {
    name: 'tool-timer',
    run: async (p) => {
      await typeNotes(p);
      await command(p, 'Open timers', 'Open timers');
      const d = p.getByRole('dialog', { name: 'Timers' });
      await d.getByRole('button', { name: 'Add timer' }).click();
      await d.getByRole('button', { name: 'Start' }).click();
      await expect(d.getByText('Running')).toBeVisible();
    },
  },
  {
    name: 'tool-calculator',
    run: async (p) => {
      await typeNotes(p);
      await command(p, 'Open calculator', 'Open calculator');
      const e = p.getByRole('textbox', { name: 'Expression' });
      await e.fill('2pi * 3');
      await p.keyboard.press('Enter');
      await e.fill('5 km to mi');
      await p.keyboard.press('Enter');
      await expect(p.locator('#calc-result')).toHaveText(/^= 3\.1/);
    },
  },
  {
    name: 'tool-upcoming',
    run: async (p) => {
      await typeNotes(p);
      await command(p, 'Open upcoming', 'Open upcoming');
      await p.getByRole('dialog', { name: /Upcoming/ }).waitFor();
    },
  },
];

const only = process.env.CAP_ONLY?.split(',');

for (const shot of SHOTS) {
  if (only && !only.includes(shot.name)) continue;
  for (const theme of THEMES)
    test(`${shot.name}-${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.clock.setFixedTime(new Date('2026-09-30T10:00:00'));
      await page.setViewportSize(shot.viewport ?? { width: 1280, height: 800 });
      const boot = { ...shot.boot, os: { dark: theme === 'dark' }, settings: { appearance: { theme } } };
      await page.addInitScript(
        (o) => {
          window.__OPENNOTE_DEV__ = { fixture: o.fixture } as typeof window.__OPENNOTE_DEV__;
          window.__OPENNOTE_BOOT__ = { ...o.boot, bootVersion: 1 } as typeof window.__OPENNOTE_BOOT__;
        },
        { boot, fixture: shot.fixture ?? 'sample' },
      );
      await page.goto(shot.path ?? '/');
      await shot.run(page);
      await settle(page);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${RAW}/${shot.name}-${theme}.png`, animations: 'disabled', caret: 'hide' });
    });
}
