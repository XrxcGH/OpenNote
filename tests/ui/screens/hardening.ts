// Phase 13's screens, for the focus walk, axe, and the screenshot matrix. They are Privacy, Help with the
// self-check, the consent screen, a crash report under review, the feedback file under review, and safe start.

import type { Page } from '@playwright/test';
import { defineScreens } from '../screens';

const PICKED = '/?consent=accepted';

/** Waits for the workspace, then opens a section of Settings by its link. */
async function openSection(page: Page, name: string): Promise<void> {
  await page.locator('[data-workspace]').waitFor();
  await page.keyboard.press('Control+Comma');
  await page.getByRole('heading', { level: 1 }).first().waitFor();
  const link = page.getByRole('link', { name, exact: true });
  if (await link.isVisible()) await link.click();
  await page.getByRole('heading', { level: 1, name, exact: true }).waitFor();
}

async function runCommand(page: Page, search: string, name: RegExp): Promise<void> {
  await page.locator('[data-workspace]').waitFor();
  await page.keyboard.press('Control+KeyK');
  await page.getByRole('combobox').fill(search);
  await page.getByRole('option', { name }).click();
}

export default defineScreens([
  {
    id: 'privacy.panel',
    description: 'Settings, Privacy, with the network uses, Work offline, and two saved crash reports',
    path: PICKED,
    prepare: (page) => openSection(page, 'Privacy'),
  },
  {
    id: 'privacy.offline',
    description: 'Settings, Privacy, with Work offline on and every network use blocked',
    path: '/?offline',
    prepare: (page) => openSection(page, 'Privacy'),
  },
  {
    id: 'help.selfCheck',
    description: 'Settings, Help, with the version and a self-check where everything is in order',
    prepare: async (page) => {
      await openSection(page, 'Help');
      await page.getByRole('status').filter({ hasText: 'Everything is in order.' }).waitFor();
    },
  },
  {
    id: 'crashReports.consent',
    description: 'The consent screen for crash reports, with the example report open',
    prepare: async (page) => {
      await openSection(page, 'Privacy');
      await page.getByRole('switch', { name: 'Save crash reports on this computer' }).click();
      const dialog = page.getByRole('dialog', { name: 'Save crash reports on this computer?' });
      await dialog.getByRole('button', { name: 'See an example report' }).click();
      await dialog.getByRole('region', { name: 'An example report' }).getByText('opennote.exe').first().waitFor();
    },
  },
  {
    id: 'crashReports.review',
    description: 'A saved crash report in full, before it is sent',
    path: PICKED,
    prepare: async (page) => {
      await openSection(page, 'Privacy');
      await page.getByRole('button', { name: 'Review' }).first().click();
      await page
        .getByRole('dialog', { name: 'Review before sending' })
        .getByRole('region')
        .getByText(/0xc0000005/)
        .waitFor();
    },
  },
  {
    id: 'feedback.form',
    description: 'Send feedback, the form with a description',
    prepare: async (page) => {
      await runCommand(page, 'send feedback', /Send feedback/);
      await page.getByRole('textbox', { name: 'What happened?' }).fill('The page jumped when I scrolled.');
    },
  },
  {
    id: 'feedback.review',
    description: 'Send feedback, the whole file on screen before it is saved',
    prepare: async (page) => {
      await runCommand(page, 'send feedback', /Send feedback/);
      await page.getByRole('textbox', { name: 'What happened?' }).fill('The page jumped when I scrolled.');
      await page.getByRole('button', { name: 'Review the file' }).click();
      await page.getByRole('region', { name: 'The whole file' }).waitFor();
    },
  },
  {
    id: 'safeStart.offer',
    description: 'The offer to start in safe mode after two crashes in a row',
    path: '/?crashes=2',
    prepare: async (page) => {
      await page.getByRole('dialog', { name: 'OpenNote did not close properly' }).waitFor();
    },
  },
  {
    id: 'safeStart.notice',
    description: 'The safe mode notice in the title bar, open, with what is off',
    path: '/?crashes=2',
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Start in safe mode' }).click();
      await page.getByRole('button', { name: 'OpenNote is in safe mode' }).click();
      await page.getByText('Embeds, which show their saved preview instead').waitFor();
    },
  },
]);
