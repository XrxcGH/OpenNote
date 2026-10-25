// The screens of Phases 5 to 13 and the quality-of-life dialogs, for the focus walk, axe, and the screenshot matrix
// (A4-37): search, export, and import, the tool windows, the graph view, Home, daily notes, flashcards, connectors,
// on-device intelligence, recording, the Draw tab, and the Check dialogs. Each state is reached the way a person
// reaches it, by keys, the palette, and the tree's menu, so a screen that cannot be reached fails here first.
// Baselines come only from the update-screenshots workflow.

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { defineScreens } from '../screens';
import { loose as n } from '../pseudoName';
import { openSettingsSection } from '../settingsOpen';

/** Waits for the shell, so the shortcut listeners are installed before a key is pressed. */
async function ready(page: Page): Promise<void> {
  await page.locator('[data-workspace]').waitFor();
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

/** The medium layout keeps the notebooks behind their rail, so this opens the drawer there. */
async function showNotebooks(page: Page): Promise<void> {
  const rail = page.getByRole('button', { name: n('Show notebooks') });
  if (await rail.isVisible()) await rail.click();
}

async function openPage(page: Page, section = 'Lectures', title = 'Membranes'): Promise<void> {
  await ready(page);
  await showNotebooks(page);
  await page
    .getByRole('tree', { name: n('Notebooks') })
    .getByRole('treeitem', { name: section })
    .click();
  await page
    .getByRole('tree', { name: n('Pages') })
    .getByRole('treeitem', { name: title })
    .click();
  await page.getByRole('heading', { level: 1, name: title }).waitFor();
  await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached', timeout: 20_000 });
}

async function runCommand(page: Page, search: string, name: RegExp): Promise<void> {
  await page.keyboard.press('Control+KeyK');
  await page.getByRole('combobox', { name: n('Search commands and pages') }).fill(search);
  await page.getByRole('option', { name }).first().click();
}

async function openSettings(page: Page, section: string): Promise<void> {
  await ready(page);
  await openSettingsSection(page, n(section), n('Settings sections'));
}

async function openExport(page: Page): Promise<void> {
  await ready(page);
  await showNotebooks(page);
  await page
    .getByRole('tree', { name: n('Notebooks') })
    .getByRole('treeitem', { name: n('Lectures') })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: n('Export…') }).click();
  await page.getByRole('dialog', { name: n('Export "Lectures"', { prefix: true }) }).waitFor();
}

async function openImport(page: Page): Promise<void> {
  await ready(page);
  await runCommand(page, 'import notes', n('Import notes', { contains: true }));
  await page.getByRole('dialog', { name: n('Import notes') }).waitFor();
}

export default defineScreens([
  {
    id: 'search.panel',
    pseudo: true,
    description: 'Search notes, open with nothing typed yet',
    prepare: async (page) => {
      await ready(page);
      await page.keyboard.press('Control+Shift+KeyF');
      await page.getByRole('combobox', { name: n('Search notes') }).waitFor();
    },
  },
  {
    id: 'search.none',
    pseudo: true,
    description: 'Search notes, with a word that no page has',
    prepare: async (page) => {
      await ready(page);
      await page.keyboard.press('Control+Shift+KeyF');
      await page.getByRole('combobox', { name: n('Search notes') }).fill('zebrafish');
      await page.getByText(n('No pages match.')).waitFor();
    },
  },
  {
    id: 'export.dialog',
    pseudo: true,
    description: 'Export a section, with the format and the scope to choose',
    prepare: openExport,
  },
  {
    id: 'export.finished',
    pseudo: true,
    description: 'Export a section as a Word document, finished',
    prepare: async (page) => {
      await openExport(page);
      const dialog = page.getByRole('dialog', { name: n('Export "Lectures"', { prefix: true }) });
      await dialog.getByRole('radio', { name: n('Word document', { contains: true }) }).click();
      await dialog.getByRole('button', { name: n('Choose a folder…') }).click();
      await dialog.getByText('C:\\Users\\Sample\\Documents').waitFor();
      await dialog.getByRole('button', { name: n('Export') }).click();
      await dialog.getByRole('heading', { name: n('Export finished') }).waitFor();
    },
  },
  {
    id: 'import.dialog',
    pseudo: true,
    description: 'Import notes, before a file is chosen',
    prepare: openImport,
  },
  {
    id: 'import.review',
    pseudo: true,
    description: 'Import notes, showing what will come over before anything is added',
    prepare: async (page) => {
      await openImport(page);
      const dialog = page.getByRole('dialog', { name: n('Import notes') });
      await dialog.getByRole('button', { name: n('Choose a file…') }).click();
      await dialog
        .getByRole('heading', { name: n('pages will come into a new notebook', { contains: true }) })
        .waitFor();
    },
  },
  {
    id: 'tools.calculator',
    pseudo: true,
    description: 'The calculator window with an answer',
    prepare: async (page) => {
      await ready(page);
      await runCommand(page, 'calculator', n('Open calculator', { contains: true }));
      await page.getByRole('textbox', { name: n('Expression') }).fill('2pi * 3');
      await page.keyboard.press('Enter');
      await page
        .locator('#calc-result')
        .getByText(/= 18\.8/)
        .waitFor();
    },
  },
  {
    id: 'tools.timers',
    pseudo: true,
    description: 'The timers window with one timer that has not started',
    prepare: async (page) => {
      await ready(page);
      await runCommand(page, 'timers', n('Open timers', { contains: true }));
      await page
        .getByRole('dialog', { name: n('Timers') })
        .getByRole('button', { name: n('Add timer') })
        .click();
      await page.getByRole('timer', { name: n('Timer 1') }).waitFor();
    },
  },
  {
    id: 'tools.upcoming',
    pseudo: true,
    description: 'The Upcoming window',
    prepare: async (page) => {
      await ready(page);
      await runCommand(page, 'upcoming', n('Open upcoming', { contains: true }));
      const dialog = page.getByRole('dialog', { name: n('Upcoming') });
      await dialog.waitFor();
      // The window slides in: take the picture once its box is the same on two frames in a row.
      let last = '';
      await expect
        .poll(async () => {
          const now = JSON.stringify(await dialog.boundingBox());
          await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
          const same = now === last;
          last = now;
          return same;
        })
        .toBe(true);
    },
  },
  {
    id: 'graph.view',
    pseudo: true,
    description: 'The graph view of links between pages',
    prepare: async (page) => {
      await ready(page);
      await runCommand(page, 'graph view', n('Open the graph view', { contains: true }));
      await page.getByRole('heading', { name: n('Connections') }).waitFor();
    },
  },
  {
    id: 'home.view',
    pseudo: true,
    description: 'Home, with its recent pages and notebooks',
    prepare: async (page) => {
      await ready(page);
      await runCommand(page, 'home', n('Go home', { prefix: true }));
      await page.getByRole('heading', { level: 1 }).first().waitFor();
    },
  },
  {
    id: 'daily.calendar',
    pseudo: true,
    description: 'The daily notes calendar for the month',
    prepare: async (page) => {
      await ready(page);
      await runCommand(page, 'daily notes', n('Open the daily notes calendar', { contains: true }));
      await page.getByRole('heading', { name: n('Daily notes') }).waitFor();
    },
  },
  {
    id: 'flashcards.deck',
    pseudo: true,
    description: 'Flashcards, the study window',
    prepare: async (page) => {
      await ready(page);
      await runCommand(page, 'flashcards', n('Open flashcards', { contains: true }));
      await page.getByRole('dialog', { name: n('Flashcards') }).waitFor();
    },
  },
  {
    id: 'connectors.settings',
    pseudo: true,
    description: 'Settings, Connectors, with each connector off until it is turned on',
    prepare: (page) => openSettings(page, 'Connectors'),
  },
  {
    id: 'intel.settings',
    pseudo: true,
    description: 'Settings, On-device intelligence, every feature off',
    prepare: (page) => openSettings(page, 'On-device intelligence'),
  },
  {
    id: 'storage.settings',
    pseudo: true,
    description: 'Settings, Storage and backups, with Back up now',
    prepare: (page) => openSettings(page, 'Storage and backups'),
  },
  {
    id: 'windows.settings',
    pseudo: true,
    description: 'Settings, Windows and power, with quick capture and tabs',
    prepare: (page) => openSettings(page, 'Windows and power'),
  },
  {
    id: 'recording.settings',
    pseudo: true,
    description: 'Settings, Recording',
    prepare: (page) => openSettings(page, 'Recording'),
  },
  {
    id: 'recording.paused',
    pseudo: true,
    description: 'A recording in a page, paused, with the indicator in the title bar',
    prepare: async (page) => {
      await openPage(page);
      await runCommand(page, 'start recording', n('Start recording', { contains: true }));
      const indicator = page.getByTestId('recording-indicator');
      await indicator.waitFor();
      await indicator.click();
      // The popover's own Pause, so the popover stays open whether the ribbon has its Pause yet.
      await page
        .getByRole('dialog')
        .getByRole('button', { name: n('Pause') })
        .click();
      // A small window shows the indicator as a dot with no words, so the popover's Resume says it is paused.
      await page
        .getByRole('button', { name: n('Resume') })
        .first()
        .waitFor();
    },
  },
  {
    id: 'draw.tab',
    pseudo: true,
    description: 'The Draw tab of the command bar on a page',
    sizes: ['expanded', 'wide'],
    prepare: async (page) => {
      await openPage(page);
      await page.getByRole('tab', { name: n('Draw') }).click();
      await page.getByRole('tabpanel', { name: n('Draw') }).waitFor();
    },
  },
  {
    id: 'qol.checkNotebook',
    pseudo: true,
    description: 'Check notebook, the list of problems it found',
    prepare: async (page) => {
      await openPage(page);
      await runCommand(page, 'check notebook', n('Check notebook', { contains: true }));
      await page.getByRole('dialog', { name: n('Check Biology 101') }).waitFor();
    },
  },
  {
    id: 'qol.checkAccessibility',
    pseudo: true,
    description: 'Check accessibility on a page',
    prepare: async (page) => {
      await openPage(page);
      await runCommand(page, 'check accessibility', n('Check accessibility', { contains: true }));
      await page.getByRole('dialog', { name: n('Check accessibility') }).waitFor();
    },
  },
]);
